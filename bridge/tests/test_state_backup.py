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
