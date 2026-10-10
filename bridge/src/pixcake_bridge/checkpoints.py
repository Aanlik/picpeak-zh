"""Durable two-phase checkpoints with caller-owned identities."""
import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import HTTPException
from .state_backup import atomic_json

LOCK_WAIT_SECONDS = 2
PREPARED_SECONDS = 60
BACKUP_SECONDS = 1800


async def payload(request):
    try:
        value = await request.json()
    except ValueError as error:
        raise HTTPException(400, '检查点请求不是有效 JSON') from error
    if not isinstance(value, dict):
        raise HTTPException(400, '检查点请求必须是 JSON 对象')
    return value


def token(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(400, '检查点任务 ID 无效') from error


def path(engine):
    return engine.config.projects_file.parent / 'checkpoint-state.json'


def cancelled(engine, task):
    file = engine.config.projects_file.parent / 'checkpoint-cancellations.json'
    entries = json.loads(file.read_text()) if file.exists() else {}
    return entries.get(task, 0) > time.time()


def cancel_intent(engine, task):
    file = engine.config.projects_file.parent / 'checkpoint-cancellations.json'
    entries = json.loads(file.read_text()) if file.exists() else {}
    entries = {key: expiry for key, expiry in entries.items() if expiry > time.time()}
    entries[task] = time.time() + 86400
    # Caller IDs are UUIDs; bounded receipts cover late requests without growing forever.
    entries = dict(list(entries.items())[-1000:])
    atomic_json(file, entries)


def apply(engine, record):
    engine.checkpoint_info = record
    engine.maintenance_token = record['token']
    if record['phase'] == 'active' and record['purpose'] == 'restore':
        engine.maintenance_until = float('inf')
        engine.maintenance_reason = '项目正在恢复，请等待恢复任务完成'
    else:
        engine.maintenance_until = time.monotonic() + max(0, record['expires_at'] - time.time())
        engine.maintenance_reason = None


def save(engine, record):
    atomic_json(path(engine), record)
    apply(engine, record)


def clear(engine):
    path(engine).unlink(missing_ok=True)
    engine.checkpoint_info = None
    engine.maintenance_token = None
    engine.maintenance_until = 0
    engine.maintenance_reason = None


def refresh(engine):
    # A failed restore's explicit block requires an operator's release.
    if (engine.config.projects_file.parent / 'restore-block.json').exists():
        return
    record = engine.checkpoint_info
    if record and (cancelled(engine, record['token']) or
                   (record['expires_at'] is not None and record['expires_at'] <= time.time())):
        clear(engine)


def load(engine):
    file = path(engine)
    if file.exists():
        record = json.loads(file.read_text())
        if record['phase'] not in {'prepared', 'active'} or record['purpose'] not in {'backup', 'restore'}:
            raise ValueError('检查点恢复日志无效')
        record['token'] = token(record['token'])
        apply(engine, record)
        refresh(engine)


@asynccontextmanager
async def locked(engine):
    try:
        await asyncio.wait_for(engine.lock.acquire(), timeout=LOCK_WAIT_SECONDS)
    except TimeoutError as error:
        raise HTTPException(409, '正在同步照片，请稍后重试备份或恢复') from error
    try:
        refresh(engine)
        yield
    finally:
        engine.lock.release()
