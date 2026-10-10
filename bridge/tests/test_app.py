import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select
from urllib.parse import unquote_plus

from pixcake_bridge.app import create_app
from pixcake_bridge.config import ProjectConfig
from pixcake_bridge.models import Delivery, Photo, Project
from test_engine import setup


def test_admin_auth_actions_csrf(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.raw_root = tmp_path / "camera"
    cfg.delivery_root = tmp_path / "delivery"
    cfg.projects_file = tmp_path / "projects.json"
    cfg.delivery_host_root = "/nas/Projects"
    raw_job = cfg.raw_root / "2026" / "portrait"
    raw_job.mkdir(parents=True)
    cfg.delivery_root.mkdir()
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/").status_code == 401
        client.auth = ("admin", cfg.admin_password)
        assert "精修同步工作台" in client.get("/").text
        assert client.get("/api/projects").json()[0]["stage"] == "SELECTING"
        assert sum(1 for route in client.app.routes if getattr(route, "path", None) == "/api/projects/{event_id}/detail") == 1
        detail = client.get("/api/projects/7/detail").json()
        assert detail["event_id"] == 7
        assert detail["delivery_path"] == f"/nas/Projects/{tmp_path.name}"
        assert client.post("/api/projects/7/stage", json={"stage": "EDITING"}).json() == {"success": True, "stage": "EDITING"}
        client.post("/api/projects/7/stage", json={"stage": "ARCHIVED"})
        assert client.post("/api/projects/7/restore").json() == {"success": True, "stage": "EDITING"}
        assert client.post("/api/projects/7/stage", json={"stage": "UNKNOWN"}).status_code == 400
        assert client.post("/api/projects/7/sync").status_code == 200
        assert client.post("/api/projects/999/sync").status_code == 404
        assert client.post("/projects/7/stage", data={"stage": "EDITING"}, headers={"Origin": "http://evil.example"}).status_code == 403
        assert client.post("/projects/7/stage", data={"stage": "EDITING"}).status_code == 200
        assert client.post("/projects/7/stage", data={"stage": "SELECTING"}).status_code == 200
        assert client.post("/projects/7/retry").status_code == 400
        assert client.post("/projects/7/sync").status_code == 200
        assert client.post("/projects/999/sync").status_code == 404
        assert client.post("/projects/7/unknown").status_code == 400
        assert "摄影师怎么接手客户选片" in client.get("/").text
        response = client.post("/projects", data={
            "name": "新项目",
            "event_id": "9",
            "raw_subdir": "2026/portrait",
        }, follow_redirects=False)
        assert response.status_code == 303
        created = next(p for p in cfg.projects if p.event_id == 9)
        assert created.raw == raw_job
        assert created.selected.is_dir() and created.final.is_dir() and created.history.is_dir()
        assert '"event_id": 9' in cfg.projects_file.read_text()
        assert client.post("/projects", data={
            "name": "路径越界",
            "event_id": "10",
            "raw_subdir": "../../etc",
        }, follow_redirects=False).status_code == 303
        outside = tmp_path / "outside"
        outside.mkdir()
        (cfg.raw_root / "linked-escape").symlink_to(outside, target_is_directory=True)
        assert client.post("/projects", data={
            "name": "符号链接越界",
            "event_id": "11",
            "raw_subdir": "linked-escape",
        }, follow_redirects=False).status_code == 303
        (cfg.delivery_root / "event-12-链接目录").symlink_to(outside, target_is_directory=True)
        assert client.post("/projects", data={
            "name": "链接目录",
            "event_id": "12",
            "raw_subdir": "2026/portrait",
        }, follow_redirects=False).status_code == 303


def test_retry_requires_confirmation_for_unknown_upload(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        photo = Photo(project_id=project.id, photo_id=999, source_filename="unknown.jpg", selected=True)
        session.add(photo)
        session.flush()
        session.add(Delivery(
            photo_pk=photo.id,
            sha256="a" * 64,
            marker="unknown.__bridge_" + "a" * 64 + ".jpg",
            snapshot=str(tmp_path / "snapshot.jpg"),
            state="UNKNOWN",
        ))
        session.commit()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ("admin", cfg.admin_password)
        blocked = client.post("/api/projects/7/retry", json={"confirm_unknown": False})
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "UNKNOWN_CONFIRMATION_REQUIRED"
        assert blocked.json()["detail"]["count"] == 1
        confirmed = client.post("/api/projects/7/retry", json={"confirm_unknown": True})
        assert confirmed.status_code == 200
        with engine.sessions() as session:
            delivery = session.scalar(select(Delivery))
            assert delivery.state == "PENDING"
    db.dispose()


def test_prepare_version_folder_and_reject_stale_version(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        session.add(Photo(project_id=project.id, photo_id=1, source_filename="DSC00001.JPG", selected=True))
        session.commit()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ("admin", cfg.admin_password)
        prepared = client.post("/api/projects/7/photos/1/version-folder", json={"expected_current_version": 0})
        assert prepared.status_code == 200
        assert prepared.json() == {"version": 1, "folder": str(cfg.projects[0].final / "V1")}
        stale = client.post("/api/projects/7/photos/1/version-folder", json={"expected_current_version": 1})
        assert stale.status_code == 409
    db.dispose()


def test_auto_mount_creates_workspace_only_in_project_scoped_delivery_mount(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.raw_host_root = tmp_path / "nas" / "Camera"
    cfg.raw_root = tmp_path / "camera"
    raw_job = cfg.raw_root / "2026-10-04"
    raw_job.mkdir(parents=True)
    cfg.delivery_root = tmp_path / "delivery"
    cfg.delivery_root.mkdir()
    scoped_host = cfg.raw_host_root / "2026-10-04" / "PixCakeDelivery"
    scoped_container = tmp_path / "delivery-event-9"
    scoped_host.mkdir(parents=True)
    scoped_container.mkdir()
    cfg.delivery_host_root = str(tmp_path / "nas" / "Camera" / "2026-10-04" / "PixCakeDelivery")
    cfg.project_delivery_mounts = {
        9: {"container": str(scoped_container), "host": str(scoped_host)},
    }
    cfg.projects_file = tmp_path / "projects.json"
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ("admin", cfg.admin_password)
        assert client.get("/api/projects/9/mount-status?raw_subdir=2026-10-04").json() == {"writable_mount_ready": True}
        response = client.post("/projects", data={
            "name": "2026-10-04",
            "event_id": "9",
            "raw_subdir": "2026-10-04",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert response.status_code == 303
        created = next(project for project in cfg.projects if project.event_id == 9)
        assert created.raw == raw_job
        assert created.selected == scoped_container / "03_SELECTED_RAW"
        assert created.selected.is_dir() and created.final.is_dir() and created.history.is_dir()

        cfg.project_delivery_mounts[10] = {
            "container": str(scoped_container),
            "host": str(tmp_path / "nas" / "PixCakeDelivery"),
        }
        assert client.get("/api/projects/10/mount-status?raw_subdir=2026-10-04").json() == {"writable_mount_ready": False}
        response = client.post("/projects", data={
            "name": "权限范围不匹配",
            "event_id": "10",
            "raw_subdir": "2026-10-04",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert response.status_code == 303
        assert not any(project.event_id == 10 for project in cfg.projects)
        assert "PixCakeDelivery 文件夹单独挂载" in unquote_plus(response.headers["location"])
    db.dispose()


def test_legacy_project_folder_is_moved_to_scoped_mount_without_overwrite(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    mount = tmp_path / "PixCakeDelivery"
    legacy = mount / "event-7-测试项目"
    for name in ("03_SELECTED_RAW", "04_FINAL", "05_HISTORY"):
        (legacy / name).mkdir(parents=True)
    raw = cfg.projects[0].raw
    (legacy / "03_SELECTED_RAW" / "DSC00001.ARW").write_bytes(b"raw-copy")
    (legacy / "04_FINAL" / "V1").mkdir()
    (legacy / "04_FINAL" / "V1" / "DSC00001.JPG").write_bytes(b"final")
    cfg.delivery_root = mount
    cfg.projects_file = tmp_path / "projects.json"
    cfg.projects[0] = ProjectConfig(
        "测试项目", 7, raw,
        legacy / "03_SELECTED_RAW", legacy / "04_FINAL", legacy / "05_HISTORY",
    )
    cfg.migrate_legacy_delivery_layout()
    assert cfg.projects[0].selected == mount / "03_SELECTED_RAW"
    assert (mount / "03_SELECTED_RAW" / "DSC00001.ARW").read_bytes() == b"raw-copy"
    assert (mount / "04_FINAL" / "V1" / "DSC00001.JPG").read_bytes() == b"final"
    assert str(mount / "04_FINAL") in cfg.projects_file.read_text()
    assert not legacy.exists()
    db.dispose()


def test_unbind_is_idempotent_and_preserves_camera_and_delivery_files(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    original = cfg.projects[0].raw / 'DSC00001.ARW'
    final = cfg.projects[0].final / 'DSC00001.JPG'
    final.write_bytes(b'final')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.delete('/api/projects/7').status_code == 200
        assert client.delete('/api/projects/7').status_code == 200
        assert client.get('/api/projects').json() == []
        assert cfg.projects_file.read_text() == '[]'
        assert original.read_bytes() == b'RAW-1'
        assert final.read_bytes() == b'final'
    db.dispose()


async def test_retry_rechecks_unknown_after_waiting_for_sync_lock(tmp_path):
    import asyncio
    import httpx
    engine, remote, cfg, db = setup(tmp_path)
    await engine.sync()
    with engine.sessions() as s:
        photo = s.scalar(select(Photo))
        s.add(Delivery(photo_pk=photo.id, sha256='a'*64, marker='m', snapshot=str(tmp_path/'snapshot.jpg'), state='UPLOADING'))
        s.commit()
    app = create_app(cfg, remote, start_workers=False)
    app.state.engine, app.state.config = engine, cfg
    async def no_sync(*args):
        pass
    engine.sync = no_sync
    await engine.lock.acquire()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', auth=('admin', cfg.admin_password)) as client:
        pending = asyncio.create_task(client.post('/api/projects/7/retry', json={'confirm_unknown': False}))
        await asyncio.sleep(.02)
        assert not pending.done()
        with engine.sessions() as s:
            s.scalar(select(Delivery)).state = 'UNKNOWN'
            s.commit()
        engine.lock.release()
        response = await pending
        assert response.status_code == 409
    with engine.sessions() as s:
        assert s.scalar(select(Delivery)).state == 'UNKNOWN'
    db.dispose()


def test_authenticated_checkpoint_pauses_sync_and_restores_state(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.post('/api/state/checkpoint', json={}).status_code == 401
        client.auth = ('admin', cfg.admin_password)
        saved = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': saved['token']}).status_code == 200
        assert saved['state']['version'] == 1
        assert client.post('/api/projects/7/stage', json={'stage':'EDITING'}).status_code == 503
        assert client.post('/api/state/restore', json={'token':'wrong', 'state':saved['state']}).status_code == 409
        assert client.post('/api/state/restore', json=saved).status_code == 200
        assert client.post('/api/state/release', json={'token':saved['token']}).status_code == 200
        assert client.post('/api/projects/7/stage', json={'stage':'EDITING'}).status_code == 200
    db.dispose()


def test_failed_restore_pause_survives_restart_and_requires_authenticated_release(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        checkpoint = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': checkpoint['token']}).status_code == 200
        assert client.post('/api/state/block', json={'token': 'wrong'}).status_code == 409
        assert client.post('/api/state/block', json={'token': checkpoint['token'], 'reason': '恢复失败'}).status_code == 200
        assert client.post('/api/state/renew', json={'token': checkpoint['token']}).status_code == 200
        assert client.app.state.engine.maintenance_until == float('inf')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get('/api/state/status').status_code == 401
        client.auth = ('admin', cfg.admin_password)
        assert client.get('/api/state/status').json() == {'blocked': True, 'reason': '恢复失败', 'token': checkpoint['token']}
        assert '精修同步已暂停' in client.get('/').text
        assert any(error['message'] == '恢复失败' for error in client.get('/api/projects/7/detail').json()['errors'])
        assert client.post('/api/projects/7/sync', json={}).status_code == 503
        assert client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).status_code == 409
        assert client.post('/api/state/release', json={'token': 'wrong'}).status_code == 409
        assert (tmp_path / 'restore-block.json').exists()
        assert client.post('/api/state/release', json={'token': checkpoint['token']}).status_code == 200
        assert not (tmp_path / 'restore-block.json').exists()
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
    db.dispose()


def test_checkpoint_repairs_interrupted_unbind_and_restart_cleans_orphans(tmp_path, monkeypatch):
    from pixcake_bridge import project_state
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False), raise_server_exceptions=False) as client:
        client.auth = ('admin', cfg.admin_password)
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
        with monkeypatch.context() as patch:
            patch.setattr(project_state, 'delete_project_rows', lambda *args: (_ for _ in ()).throw(RuntimeError('commit failed')))
            assert client.delete('/api/projects/7').status_code == 500
        assert (tmp_path / 'unbind-state.json').exists()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        client.auth = ('admin', cfg.admin_password)
        assert not (tmp_path / 'unbind-state.json').exists()
        saved = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': saved['token']}).status_code == 200
        assert saved['state']['projects'] == []
        assert saved['state']['tables']['projects'] == []
        assert client.post('/api/state/restore', json=saved).status_code == 200
        assert client.post('/api/state/release', json={'token': saved['token']}).status_code == 200
    assert (tmp_path / '01_RAW' / 'DSC00001.ARW').exists()
