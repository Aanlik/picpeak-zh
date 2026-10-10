"""Versioned workflow checkpoint, without credentials or camera file contents."""
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from sqlalchemy import DateTime, select
from .config import ProjectConfig
from .models import Base


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as file:
        json.dump(value, file, ensure_ascii=False)
        file.flush()
        os.fsync(file.fileno())
        temporary = Path(file.name)
    temporary.replace(path)


def export_state(config, sessions):
    with sessions() as session:
        tables = {}
        for table in Base.metadata.sorted_tables:
            tables[table.name] = [{key: value.isoformat() if isinstance(value, datetime) else value
                                  for key, value in dict(row).items()}
                                 for row in session.execute(select(table)).mappings()]
    return {'version': 1, 'projects': [{key: str(getattr(p, key)) if key in {'raw', 'selected', 'final', 'history'} else getattr(p, key)
                                     for key in ('name', 'event_id', 'raw', 'selected', 'final', 'history')} for p in config.projects],
            'tables': tables}


def restore_state(payload, config, sessions, *, journal=True):
    if not isinstance(payload, dict) or payload.get('version') != 1:
        raise ValueError('不支持的精修状态备份版本')
    tables = {table.name: table for table in Base.metadata.sorted_tables}
    if set(payload.get('tables', {})) != set(tables):
        raise ValueError('精修状态备份缺少数据表')
    projects = []
    for value in payload.get('projects', []):
        project = ProjectConfig(**{key: Path(item) if key in {'raw', 'selected', 'final', 'history'} else item for key, item in value.items()})
        old = next((p for p in config.projects if p.event_id == project.event_id), None)
        raw_roots = [config.raw_root] + ([old.raw] if old else [])
        if not any(project.raw.resolve().is_relative_to(root.resolve()) for root in raw_roots):
            raise ValueError('备份 RAW 路径不在已授权挂载内')
        writable = config.delivery_root_for(project.event_id).resolve()
        for key in ('selected', 'final', 'history'):
            target = getattr(project, key)
            old_root = getattr(old, key).resolve() if old else writable
            if not (target.resolve().is_relative_to(writable) or target.resolve() == old_root):
                raise ValueError('备份交付路径不在已授权挂载内')
        project.validate()
        projects.append(project)
    outputs = [getattr(p, key).resolve() for p in projects for key in ('selected', 'final', 'history')]
    for index, root in enumerate(outputs):
        if any(root == other or root in other.parents or other in root.parents for other in outputs[index + 1:]):
            raise ValueError('备份项目的交付目录重叠')
    if len({p.event_id for p in projects}) != len(projects):
        raise ValueError('备份包含重复项目')
    project_ids = {row['id']: row['event_id'] for row in payload['tables']['projects']}
    configured = {p.event_id: p for p in projects}
    if set(project_ids.values()) != set(configured):
        raise ValueError('备份项目配置与数据库不一致')
    photo_roots = {}
    for photo in payload['tables']['photos']:
        cfg = configured[project_ids[photo['project_id']]]
        photo_roots[photo['id']] = cfg
        for column, root in [('raw_path', cfg.raw), ('selected_path', cfg.selected)]:
            if photo.get(column) and not Path(photo[column]).resolve().is_relative_to(root.resolve()):
                raise ValueError('备份照片路径越界')
    for name in ('deliveries', 'withdrawals'):
        for row in payload['tables'][name]:
            if row.get('snapshot') and not Path(row['snapshot']).resolve().is_relative_to(photo_roots[row['photo_pk']].history.resolve()):
                raise ValueError('备份历史路径越界')
    converted = {}
    for name, table in tables.items():
        converted[name] = []
        for row in payload['tables'][name]:
            if set(row) != {column.name for column in table.columns}:
                raise ValueError('备份字段不完整或已过期')
            converted[name].append({key: datetime.fromisoformat(value) if value and isinstance(table.c[key].type, DateTime) else value for key, value in row.items()})
    journal_path = config.projects_file.parent / 'restore-state.json'
    with sessions() as session:
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        for table in Base.metadata.sorted_tables:
            if converted[table.name]:
                session.execute(table.insert(), converted[table.name])
        if journal:
            atomic_json(journal_path, payload)
        session.commit()
    atomic_json(config.projects_file, payload['projects'])
    config.projects = projects
    journal_path.unlink(missing_ok=True)
