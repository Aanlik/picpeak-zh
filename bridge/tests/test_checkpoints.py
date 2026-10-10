import asyncio
import json
import socket
import threading
import time
import uuid

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient
from pixcake_bridge.app import create_app
from pixcake_bridge import checkpoints
from test_engine import setup


@pytest.mark.parametrize('purpose', ['backup', 'restore'])
def test_confirmed_checkpoint_survives_restart_with_original_identity(tmp_path, purpose):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    task = str(uuid.uuid4())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        saved = client.post('/api/state/checkpoint', json={'token': task, 'purpose': purpose}).json()
        assert saved['token'] == task
        assert client.post('/api/state/activate', json={'token': task}).status_code == 200
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.post('/api/projects/7/sync', json={}).status_code == 503
        assert client.post('/api/state/renew', json={'token': task}).status_code == 200
        assert client.post('/api/state/activate', json={'token': task}).status_code == 200
        if purpose == 'restore':
            assert client.app.state.engine.maintenance_until == float('inf')
            assert client.post('/api/state/restore', json=saved).status_code == 200
        assert client.post('/api/state/release', json={'token': task}).status_code == 200
        assert client.post('/api/projects/7/sync', json={}).status_code == 200


def test_unconfirmed_checkpoint_cannot_restore_and_expires_after_restart(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    task = str(uuid.uuid4())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        saved = client.post('/api/state/checkpoint', json={'token': task, 'purpose': 'restore'}).json()
        assert client.post('/api/state/restore', json=saved).status_code == 409
    file = tmp_path / 'checkpoint-state.json'
    value = json.loads(file.read_text()); value['expires_at'] = time.time() - 1
    file.write_text(json.dumps(value))
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
        assert client.post('/api/state/activate', json={'token': task}).status_code == 409
        assert not file.exists()


def test_cancel_receipt_prevents_late_prepare_and_activation_after_restart(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    task = str(uuid.uuid4())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.post('/api/state/cancel', json={'token': task}).status_code == 200
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.post('/api/state/checkpoint', json={'token': task, 'purpose': 'restore'}).status_code == 409
        assert client.post('/api/state/activate', json={'token': task}).status_code == 409
        assert client.post('/api/projects/7/sync', json={}).status_code == 200


def test_repeated_prepare_is_idempotent_and_cancel_clears_unstarted_restore(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'; db.dispose()
    task = str(uuid.uuid4())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        for _ in range(2):
            assert client.post('/api/state/checkpoint', json={'token': task, 'purpose': 'restore'}).status_code == 200
        assert client.post('/api/state/activate', json={'token': task}).status_code == 200
        assert client.post('/api/state/cancel', json={'token': task}).status_code == 200
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
        assert not (tmp_path / 'checkpoint-state.json').exists()


def test_checkpoint_rejects_invalid_payload_and_identity(tmp_path):
    engine, remote, cfg, db = setup(tmp_path); cfg.projects_file = tmp_path / 'projects.json'; db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        for payload in [None, [], {}, {'token': '../etc'}, {'token': str(uuid.uuid4()), 'purpose': 'unknown'}, {'token': str(uuid.uuid4()), 'purpose': {}}]:
            assert client.post('/api/state/checkpoint', json=payload).status_code == 400
        assert client.post('/api/projects/7/sync', json={}).status_code == 200


@pytest.mark.parametrize('scenario', ['busy', 'disconnect', 'cancel_waiter'])
def test_real_http_timeout_or_disconnect_never_creates_an_abandoned_pause(tmp_path, monkeypatch, scenario):
    engine, remote, cfg, db = setup(tmp_path); cfg.projects_file = tmp_path / 'projects.json'; db.dispose()
    app = create_app(cfg, remote, start_workers=False)
    @app.get('/test/loop')
    async def capture_loop():
        app.state.test_loop = asyncio.get_running_loop()
        return {'ok': True}
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error'))
    thread = threading.Thread(target=server.run, daemon=True); thread.start()
    task = str(uuid.uuid4())
    try:
        for _ in range(100):
            if server.started: break
            time.sleep(.02)
        assert server.started
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', auth=('admin', cfg.admin_password)) as client:
            client.get('/test/loop')
            held = threading.Event()
            async def occupy():
                async with app.state.engine.lock:
                    held.set(); await asyncio.sleep(.4)
            future = asyncio.run_coroutine_threadsafe(occupy(), app.state.test_loop); assert held.wait(2)
            if scenario == 'busy':
                monkeypatch.setattr(checkpoints, 'LOCK_WAIT_SECONDS', .1)
                assert client.post('/api/state/checkpoint', json={'token': task, 'purpose': 'restore'}, timeout=2).status_code == 409
            else:
                with pytest.raises(httpx.ReadTimeout):
                    client.post('/api/state/checkpoint', json={'token': task, 'purpose': 'restore'}, timeout=.1)
                if scenario == 'cancel_waiter':
                    assert client.post('/api/state/cancel', json={'token': task}).status_code == 200
            future.result(timeout=3); time.sleep(.15)
            assert app.state.engine.maintenance_token is None
            assert not (tmp_path / 'checkpoint-state.json').exists()
            assert client.post('/api/projects/7/sync', json={}).status_code == 200
    finally:
        server.should_exit = True; thread.join(5)
        assert not thread.is_alive()
