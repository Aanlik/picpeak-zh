from pathlib import Path
from sqlalchemy import select
from pixcake_bridge.state_backup import export_state, restore_state
from pixcake_bridge.models import Photo, Project
from test_engine import setup
import pytest

async def test_checkpoint_restores_versions_selection_and_configuration(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    await engine.sync()
    engine.set_stage(7, 'EDITING')
    saved = export_state(cfg, engine.sessions)
    engine.set_stage(7, 'DELIVERED')
    with engine.sessions() as s:
        s.query(Photo).update({'selected': False})
        s.commit()
    restore_state(saved, cfg, engine.sessions)
    with engine.sessions() as s:
        assert s.scalar(select(Project)).stage == 'EDITING'
        assert s.scalar(select(Photo)).selected
    assert cfg.projects_file.exists()
    assert not (tmp_path / 'restore-state.json').exists()
    await engine.sync()
    assert not remote.uploads
    db.dispose()

async def test_restore_rejects_unmounted_paths_before_db_changes(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    await engine.sync()
    saved = export_state(cfg, engine.sessions)
    saved['tables']['photos'][0]['selected_path'] = '/etc/passwd'
    with pytest.raises(ValueError, match='越界'):
        restore_state(saved, cfg, engine.sessions)
    with engine.sessions() as s:
        assert s.scalar(select(Photo)).selected_path != '/etc/passwd'
    db.dispose()

async def test_export_rejects_orphan_project_before_claiming_backup_success(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    await engine.sync()
    cfg.projects = []
    with pytest.raises(ValueError, match='不能生成'):
        export_state(cfg, engine.sessions)
    db.dispose()

async def test_interrupted_detachment_replays_without_touching_files(tmp_path, monkeypatch):
    from pixcake_bridge import project_state
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    await engine.sync()
    original_raw = (tmp_path / '01_RAW' / 'DSC00001.ARW').read_bytes()
    original_delete = project_state.delete_project_rows
    def fail_commit(*args):
        raise RuntimeError('simulated SQLite commit failure')
    monkeypatch.setattr(project_state, 'delete_project_rows', fail_commit)
    with pytest.raises(RuntimeError):
        project_state.detach_project(cfg, engine.sessions, 7)
    assert cfg.projects == []
    assert (tmp_path / 'unbind-state.json').exists()
    with engine.sessions() as session:
        assert session.scalar(select(Project)) is not None
    with pytest.raises(ValueError, match='不能生成'):
        export_state(cfg, engine.sessions)
    monkeypatch.setattr(project_state, 'delete_project_rows', original_delete)
    project_state.recover_detachments(cfg, engine.sessions)
    assert not (tmp_path / 'unbind-state.json').exists()
    saved = export_state(cfg, engine.sessions)
    restore_state(saved, cfg, engine.sessions)
    assert not saved['tables']['projects'] and not saved['tables']['photos']
    assert (tmp_path / '01_RAW' / 'DSC00001.ARW').read_bytes() == original_raw
    db.dispose()

async def test_detachment_sqlite_commit_failure_rolls_back_then_recovers(tmp_path):
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from pixcake_bridge.project_state import detach_project, recover_detachments
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    await engine.sync()
    def fail_commit(session):
        raise RuntimeError('fault at actual SQLAlchemy commit')
    event.listen(Session, 'before_commit', fail_commit)
    try:
        with pytest.raises(RuntimeError, match='actual SQLAlchemy commit'):
            detach_project(cfg, engine.sessions, 7)
    finally:
        event.remove(Session, 'before_commit', fail_commit)
    with engine.sessions() as session:
        assert session.scalar(select(Project)) is not None
        assert session.scalar(select(Photo)) is not None
    assert (tmp_path / 'unbind-state.json').exists()
    recover_detachments(cfg, engine.sessions)
    assert export_state(cfg, engine.sessions)['tables']['projects'] == []
    assert (tmp_path / '01_RAW' / 'DSC00001.ARW').exists()
    db.dispose()
