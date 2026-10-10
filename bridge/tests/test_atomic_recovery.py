import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import select

from pixcake_bridge.app import create_app
from pixcake_bridge.client import ApiError, PicPeak
from pixcake_bridge.engine import Engine
from pixcake_bridge.files import snapshot, sha256, index_files
from pixcake_bridge.models import Delivery, Photo, Project, Withdrawal, database
from test_engine import setup


def test_snapshot_preserves_existing_destination(tmp_path):
    source, destination = tmp_path / 'source.jpg', tmp_path / 'history.jpg'
    source.write_bytes(b'new')
    destination.write_bytes(b'old history')
    with pytest.raises(FileExistsError):
        snapshot(source, destination, 100)
    assert destination.read_bytes() == b'old history'


@pytest.mark.parametrize('body', [b'<html>proxy error</html>', b'[]', b'{"photo":null,"replaced":true}'])
async def test_invalid_upload_receipt_is_unknown(tmp_path, body):
    source = tmp_path / 'a.jpg'
    source.write_bytes(b'image')
    calls = []
    client = PicPeak('http://test', 'token', httpx.MockTransport(lambda req: calls.append(req) or httpx.Response(200, content=body)))
    with pytest.raises(ApiError) as error:
        await client.replace(1, 1, source, 'a.jpg')
    assert error.value.uncertain and len(calls) == 1
    await client.close()


async def test_lost_withdraw_receipt_recovers_after_restart(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    raw_before = sha256(cfg.projects[0].raw / 'DSC00001.ARW')
    (cfg.projects[0].raw / 'DSC00001.JPG').write_bytes(b'proof')
    await engine.sync()
    final = cfg.projects[0].final / 'V1' / 'DSC00001.JPG'
    final.write_bytes(b'final')
    await engine.sync(); await engine.sync()
    remote.rows[0]['color_label'] = None
    remote.lost_response = True
    with pytest.raises(ValueError):
        await engine.withdraw_photo(7, 1, True)
    count = len(remote.uploads)
    with engine.sessions() as s:
        assert s.scalar(select(Withdrawal)).state == 'UNKNOWN'
    db.dispose()
    db, sessions = database(cfg.database_url)
    remote.lost_response = False
    restarted = Engine(cfg, sessions, remote)
    await restarted.sync()
    with sessions() as s:
        assert s.scalar(select(Withdrawal)).state == 'SUCCESS'
        assert s.scalar(select(Photo)).delivery_hash is None
    assert len(remote.uploads) == count
    assert not final.exists()
    assert sha256(cfg.projects[0].raw / 'DSC00001.ARW') == raw_before
    db.dispose()


async def test_layout_migration_rebases_raw_and_history_across_restart(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    p = cfg.projects[0]
    mount = tmp_path / 'delivery'
    legacy = mount / 'event-7-old'
    legacy.mkdir(parents=True)
    for attribute in ('selected', 'final', 'history'):
        old = getattr(p, attribute)
        new = legacy / old.name
        old.rename(new)
        setattr(p, attribute, new)
    cfg.delivery_root = mount
    cfg.projects_file = tmp_path / 'projects.json'
    await engine.sync()
    (p.final / 'V1' / 'DSC00001.JPG').write_bytes(b'final')
    await engine.sync(); await engine.sync()
    cfg.migrate_legacy_delivery_layout()
    db.dispose()
    db, sessions = database(cfg.database_url)
    restarted = Engine(cfg, sessions, remote)
    await restarted.sync()
    with sessions() as s:
        photo = s.scalar(select(Photo))
        delivery = s.scalar(select(Delivery))
        assert photo.error is None
        assert Path(photo.selected_path).is_file()
        assert Path(delivery.snapshot).is_file()
        assert str(legacy) not in photo.selected_path
    db.dispose()


async def test_each_version_is_indexed_once_per_cycle(tmp_path):
    engine, remote, cfg, db = setup(tmp_path, 50)
    await engine.sync()
    p = cfg.projects[0]
    for photo in remote.rows:
        (p.final / 'V1' / photo['source_filename']).write_bytes(b'final')
    with patch('pixcake_bridge.engine.index_files', wraps=index_files) as indexed:
        await engine.sync()
        roots = [call.args[0] for call in indexed.call_args_list]
        assert roots.count(p.final / 'V1') == 1
        assert roots.count(p.final) == 1
    db.dispose()


async def test_version_folder_uses_project_mount(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.delivery_root = tmp_path / 'default'
    cfg.delivery_host_root = '/NAS/default'
    cfg.project_delivery_mounts = {7: {'container': str(tmp_path), 'host': '/NAS/Camera/shoot/PixCakeDelivery'}}
    await engine.sync()
    assert engine.prepare_next_version_folder(7, 1, 0)['folder'] == '/NAS/Camera/shoot/PixCakeDelivery/04_FINAL/V1'
    db.dispose()


async def test_parallel_binding_is_deduplicated(tmp_path):
    _, remote, cfg, db = setup(tmp_path)
    db.dispose()
    cfg.raw_root = tmp_path / 'Camera'; cfg.raw_root.mkdir()
    (cfg.raw_root / 'shoot').mkdir()
    cfg.delivery_root = tmp_path / 'delivery'; cfg.delivery_root.mkdir()
    cfg.projects_file = tmp_path / 'projects.json'
    original, gate, entered = remote.photos, asyncio.Event(), 0
    async def gated(event_id):
        nonlocal entered
        entered += 1
        if entered == 2: gate.set()
        await gate.wait()
        return await original(event_id)
    remote.photos = gated
    app = create_app(cfg, remote, start_workers=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', auth=('admin', cfg.admin_password)) as client:
            results = await asyncio.gather(*[client.post('/projects', data={'name': '项目', 'event_id': 9, 'raw_subdir': 'shoot'}) for _ in range(2)])
            assert all(r.status_code == 303 for r in results)
            assert len([p for p in cfg.projects if p.event_id == 9]) == 1
            assert [p['event_id'] for p in json.loads(cfg.projects_file.read_text())].count(9) == 1


async def test_archive_api_waits_for_active_sync(tmp_path):
    _, remote, cfg, db = setup(tmp_path)
    db.dispose()
    app = create_app(cfg, remote, start_workers=False)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        await engine.sync()
        entered, release = asyncio.Event(), asyncio.Event()
        original = remote.photos
        async def gated(event_id):
            entered.set(); await release.wait()
            return await original(event_id)
        remote.photos = gated
        sync = asyncio.create_task(engine.sync())
        await entered.wait()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', auth=('admin', cfg.admin_password)) as client:
            archive = asyncio.create_task(client.post('/api/projects/7/stage', json={'stage': 'ARCHIVED'}))
            await asyncio.sleep(0)
            assert not archive.done()
            release.set(); await sync
            assert (await archive).status_code == 200
            with engine.sessions() as s: assert s.scalar(select(Project)).stage == 'ARCHIVED'
            count = len(remote.uploads)
            await engine.sync()
            assert len(remote.uploads) == count

async def test_unknown_withdrawal_requires_confirmation_before_manual_retry(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    (cfg.projects[0].raw / 'DSC00001.JPG').write_bytes(b'proof')
    await engine.sync()
    final = cfg.projects[0].final / 'V1' / 'DSC00001.JPG'
    final.write_bytes(b'final')
    await engine.sync(); await engine.sync()
    remote.rows[0]['color_label'] = None
    engine.queue_withdraw(7, 1, True, '12345678-1234-1234-1234-123456789012')
    with engine.sessions() as s:
        task = s.scalar(select(Withdrawal))
        task.state = 'UNKNOWN'
        s.commit()
    app = create_app(cfg, remote)
    app.state.engine = engine
    app.state.config = cfg
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', auth=('admin', cfg.admin_password)) as client:
        denied = await client.post('/api/projects/7/retry', json={})
        assert denied.status_code == 409
        assert denied.json()['detail']['code'] == 'UNKNOWN_CONFIRMATION_REQUIRED'
        # The remote photo still has the delivered marker. A photographer has
        # verified it and explicitly confirms retrying the proof replacement.
        allowed = await client.post('/api/projects/7/retry', json={'confirm_unknown': True})
        assert allowed.status_code == 200
    with engine.sessions() as s:
        assert s.scalar(select(Withdrawal)).state == 'SUCCESS'
    assert not final.exists()
    db.dispose()
