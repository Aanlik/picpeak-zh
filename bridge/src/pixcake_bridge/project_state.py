"""Replayable project detachment; never remove camera or delivery files."""
import json
from sqlalchemy import select
from .models import Delivery, Error, Photo, Project, SyncRun, Withdrawal
from .state_backup import atomic_json


def delete_project_rows(sessions, event_id):
    with sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == event_id))
        if project:
            ids = select(Photo.id).where(Photo.project_id == project.id)
            session.query(Delivery).filter(Delivery.photo_pk.in_(ids)).delete(synchronize_session=False)
            session.query(Withdrawal).filter(Withdrawal.photo_pk.in_(ids)).delete(synchronize_session=False)
            session.query(Photo).filter(Photo.project_id == project.id).delete(synchronize_session=False)
            session.query(Error).filter(Error.project_id == project.id).delete(synchronize_session=False)
            session.query(SyncRun).filter(SyncRun.project_id == project.id).delete(synchronize_session=False)
            session.delete(project)
        session.commit()


def detach_project(config, sessions, event_id):
    journal = config.projects_file.parent / 'unbind-state.json'
    pending = json.loads(journal.read_text()) if journal.exists() else []
    if event_id not in pending:
        pending.append(event_id)
        atomic_json(journal, pending)
    current = [p for p in config.projects if p.event_id != event_id]
    payload = [{key: str(getattr(p, key)) if key in {'raw', 'selected', 'final', 'history'} else getattr(p, key)
                for key in ('name', 'event_id', 'raw', 'selected', 'final', 'history')} for p in current]
    atomic_json(config.projects_file, payload)
    config.projects = current
    delete_project_rows(sessions, event_id)
    pending.remove(event_id)
    if pending:
        atomic_json(journal, pending)
    else:
        journal.unlink(missing_ok=True)


def recover_detachments(config, sessions):
    journal = config.projects_file.parent / 'unbind-state.json'
    if journal.exists():
        for event_id in json.loads(journal.read_text()):
            if not isinstance(event_id, int) or event_id < 1:
                raise ValueError('解绑恢复日志包含无效项目')
            detach_project(config, sessions, event_id)
