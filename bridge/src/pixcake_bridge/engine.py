import asyncio
import uuid
import json
from collections import Counter
from pathlib import Path

from sqlalchemy import func, select

from .client import ApiError
from .files import FINAL_EXTENSIONS, RAW_EXTENSIONS, Stability, index_files, match_raw, materialize, safe_file, safe_name, sha256, snapshot, stem_key
from .models import Delivery, Error, Photo, Project, SyncRun, Withdrawal, now

STAGES = ["SELECTING", "EDITING", "DELIVERED", "ARCHIVED"]


class Engine:
    def __init__(self, config, sessions, client):
        self.config, self.sessions, self.client = config, sessions, client
        self.lock = asyncio.Lock()
        self.stability = Stability(config.stable_seconds)
        self.wake = asyncio.Event()
        self.rebase_layout_paths()
        with sessions() as s:
            for p in config.projects:
                row = s.scalar(select(Project).where(Project.event_id == p.event_id))
                if row is None:
                    s.add(Project(event_id=p.event_id, name=p.name))
                else:
                    row.name = p.name
            s.commit()
            # A crash between request and response must enter reconciliation,
            # never blindly repeat the mutation on restart.
            for row in s.scalars(select(Delivery).where(Delivery.state == "UPLOADING")):
                row.state = "UNKNOWN"
                row.updated = now()
            s.commit()

    def rebase_layout_paths(self):
        journal = self.config.projects_file.with_name("layout-migrations.json")
        if not journal.exists():
            return
        with self.sessions() as s:
            for record in json.loads(journal.read_text()):
                project = s.scalar(select(Project).where(Project.event_id == record["event_id"]))
                if project is None:
                    continue
                old, new = Path(record["old"]), Path(record["new"])
                def rebased(value):
                    if not value:
                        return value
                    try:
                        return str(new / Path(value).relative_to(old))
                    except ValueError:
                        return value
                for photo in s.scalars(select(Photo).where(Photo.project_id == project.id)):
                    photo.selected_path = rebased(photo.selected_path)
                    for delivery in s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id)):
                        delivery.snapshot = rebased(delivery.snapshot)
                    task = s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id))
                    if task:
                        task.snapshot = rebased(task.snapshot)
            s.commit()

    def set_stage(self, event_id, stage):
        if stage not in STAGES:
            raise ValueError("无效阶段")
        with self.sessions() as s:
            p = s.scalar(select(Project).where(Project.event_id == event_id))
            if p is None:
                raise ValueError("项目不存在")
            if stage == "ARCHIVED" and p.stage != "ARCHIVED":
                p.previous_stage = p.stage if p.stage in {"SELECTING", "EDITING", "DELIVERED"} else "SELECTING"
            elif stage != "ARCHIVED":
                p.previous_stage = None
            p.stage = stage
            if stage in {"EDITING", "DELIVERED", "ARCHIVED"}:
                p.has_entered_editing = True
            s.commit()
        self.wake.set()

    def restore_stage(self, event_id):
        with self.sessions() as s:
            p = s.scalar(select(Project).where(Project.event_id == event_id))
            if p is None:
                raise ValueError("项目不存在")
            if p.stage == "ARCHIVED":
                p.stage = p.previous_stage if p.previous_stage in {"SELECTING", "EDITING", "DELIVERED"} else "SELECTING"
                p.previous_stage = None
                s.commit()
            stage = p.stage
        self.wake.set()
        return stage

    def current_version(self, s, photo):
        return int(s.scalar(
            select(func.count(Delivery.id)).where(
                Delivery.photo_pk == photo.id,
                Delivery.state == "SUCCESS",
            )
        ) or 0)

    def output_folder(self, cfg, version, *, create=False):
        folder = cfg.final / f"V{int(version)}"
        if folder.is_symlink():
            raise ValueError("成片版本目录不能是符号链接")
        if create:
            folder.mkdir(parents=True, exist_ok=True)
        if folder.exists():
            safe_file_parent = cfg.final.resolve()
            if not folder.is_dir() or folder.resolve().parent != safe_file_parent:
                raise ValueError("成片版本目录越界或不是普通目录")
        return folder

    def prepare_next_version_folder(self, event_id, photo_id, expected_current_version=None):
        cfg = next((item for item in self.config.projects if item.event_id == event_id), None)
        if cfg is None:
            raise ValueError("项目尚未绑定")
        with self.sessions() as s:
            project = s.scalar(select(Project).where(Project.event_id == event_id))
            if project is None:
                raise ValueError("项目尚未同步")
            photo = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == photo_id))
            if photo is None:
                raise ValueError("照片尚未同步到 Bridge")
            current = self.current_version(s, photo)
            if expected_current_version is not None and int(expected_current_version) != current:
                raise ValueError("成片版本已更新，请刷新后重试")
            version = current + 1
            folder = self.output_folder(cfg, version, create=True)
            try:
                relative = folder.relative_to(self.config.delivery_root_for(event_id))
                host = self.config.delivery_host_root_for(event_id)
                shown = Path(host) / relative if host else folder
            except ValueError:
                shown = folder
            return {"version": version, "folder": str(shown)}

    def record_error(self, s, project, message):
        # No response bodies or credentials in persistent logs.
        message = str(message).replace(self.config.token, "[已隐藏]") if self.config.token else str(message)
        if s.scalar(select(Error).where(Error.project_id == project.id, Error.message == message, Error.resolved == False)) is None:
            s.add(Error(project_id=project.id, message=message))

    async def sync(self, event_id=None):
        async with self.lock:
            for cfg in self.config.projects:
                if event_id is not None and cfg.event_id != event_id:
                    continue
                with self.sessions() as s:
                    project = s.scalar(select(Project).where(Project.event_id == cfg.event_id))
                    await self.resume_withdrawals(cfg, s, project)
                    if project.stage == "ARCHIVED":
                        continue
                    run = SyncRun(project_id=project.id)
                    s.add(run)
                    s.commit()
                    failed = False
                    try:
                        # Use a complete, unfiltered snapshot: filtering green
                        # would hide cancellations. Fetch all pages before any
                        # filesystem change so an API failure cannot delete RAW.
                        remote = await self.client.photos(cfg.event_id)
                        project.connected = True
                        # PixCakeDelivery lives inside the referenced shoot
                        # folder, but contains selected RAW copies and final
                        # JPEGs. Never index those as camera originals.
                        raw_index = await asyncio.to_thread(index_files, cfg.raw, RAW_EXTENSIONS, {"PixCakeDelivery"})
                        counts = Counter(stem_key(p["source_filename"]) for p in remote if p.get("source_filename"))
                        for item in remote:
                            photo = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == item["id"]))
                            if photo is None:
                                photo = Photo(project_id=project.id, photo_id=item["id"], source_filename=item.get("source_filename") or "")
                                s.add(photo)
                                s.flush()
                            try:
                                pending = s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id, Withdrawal.state != "SUCCESS"))
                                if pending:
                                    continue
                                source = item.get("source_filename")
                                if not source:
                                    raise ValueError("PicPeak 缺少 source_filename，拒绝使用可变文件名")
                                safe_name(source)
                                if photo.source_filename and photo.source_filename != source:
                                    raise ValueError("source_filename 发生变化，请人工检查映射")
                                photo.source_filename = source
                                photo.remote_filename = item.get("original_filename")
                                # Public API mark_source=client avoids the
                                # photographer's own green triage selecting RAW.
                                was_selected = photo.selected
                                photo.selected = item.get("color_label") == "green"
                                if photo.selected and photo.delivery_hash:
                                    # Keeping an existing retouch means this is
                                    # still the delivered photo, not a new pick.
                                    photo.added_during_editing = False
                                elif photo.selected and not was_selected and project.last_sync is not None and project.stage in {"EDITING", "DELIVERED"}:
                                    # A deleted retouch is treated as a fresh
                                    # additional selection if the client picks it again.
                                    photo.added_during_editing = True
                                photo.cancelled = not photo.selected and (was_selected or photo.cancelled or bool(photo.selected_path))
                                if counts[stem_key(source)] != 1:
                                    raise ValueError("Proof stem 冲突，无法唯一映射 RAW/FINAL")
                                await self.selection(cfg, project, photo, raw_index)
                                photo.error = None
                            except (OSError, ValueError) as exc:
                                failed = True
                                photo.error = str(exc)
                                self.record_error(s, project, f"照片 {photo.photo_id}: {exc}")
                            s.commit()
                        # Missing remote photos are preserved for human review.
                        ids = {p["id"] for p in remote}
                        for photo in s.scalars(select(Photo).where(Photo.project_id == project.id)):
                            if photo.photo_id not in ids:
                                photo.error = "PicPeak 中照片缺失，已保留待精修 RAW"
                                failed = True
                                self.record_error(s, project, f"照片 {photo.photo_id}: {photo.error}")
                        failed = await self.finals(s, cfg, project, counts, ids) or failed
                        project.last_sync = now()
                    except Exception as exc:
                        # An unavailable remote prevents both selection changes
                        # and final mutations. Scheduler continues next cycle.
                        failed = True
                        project.connected = False
                        self.record_error(s, project, exc)
                    run.success, run.finished = not failed, now()
                    if not failed:
                        for error in s.scalars(select(Error).where(Error.project_id == project.id, Error.resolved == False)):
                            error.resolved = True
                    s.commit()

    async def selection(self, cfg, project, photo, raw_index):
        if photo.selected:
            raw = match_raw(photo.source_filename, raw_index, cfg.raw)
            digest = await asyncio.to_thread(sha256, raw)
            if photo.raw_hash and photo.raw_hash != digest:
                raise ValueError("原始 RAW SHA256 变化，停止处理")
            dest = cfg.selected / safe_name(raw.name)
            if photo.selected_path and Path(photo.selected_path) != dest:
                raise ValueError("RAW 路径发生变化，请人工检查")
            if dest.exists() or dest.is_symlink():
                safe_file(dest, cfg.selected)
                if await asyncio.to_thread(sha256, dest) != digest:
                    raise ValueError("待精修 RAW 被修改，拒绝覆盖")
            else:
                await asyncio.to_thread(materialize, raw, dest, self.config.materialize_mode)
            photo.selected_path, photo.materialized_hash = str(dest), digest
            photo.raw_path, photo.raw_hash = str(raw), digest
            # The first export has a dedicated target. Revisions are created
            # on demand by the authenticated request endpoint (V2, V3, ...).
            if not photo.delivery_hash:
                self.output_folder(cfg, 1, create=True)
        elif project.stage == "SELECTING" and photo.selected_path:
            if not project.has_entered_editing:
                dest = Path(photo.selected_path)
                if dest.exists() or dest.is_symlink():
                    safe_file(dest, cfg.selected)
                    if await asyncio.to_thread(sha256, dest) != photo.materialized_hash:
                        raise ValueError("取消选片时副本已变更，保留文件待人工处理")
                    dest.unlink()
                photo.selected_path = None
        # Once editing has started, cancelled RAW remains available even if
        # the photographer later rolls the project stage back to SELECTING.

    def _remove_selected_raw(self, cfg, photo):
        if photo.selected_path:
            destination = Path(photo.selected_path)
            if destination.exists() or destination.is_symlink():
                safe_file(destination, cfg.selected)
                if photo.materialized_hash and sha256(destination) != photo.materialized_hash:
                    raise ValueError("待精修 RAW 副本已变更，拒绝自动删除")
                destination.unlink()
        photo.selected_path = None
        photo.materialized_hash = None
        photo.raw_path = None
        photo.raw_hash = None

    def queue_withdraw(self, event_id, photo_id, delete_delivered, operation_id=None):
        with self.sessions() as s:
            project = s.scalar(select(Project).where(Project.event_id == event_id))
            photo = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == photo_id)) if project else None
            if not photo:
                raise ValueError("照片尚未同步")
            task = s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id))
            if task and operation_id and task.operation_id == operation_id:
                return {"processing": task.state != "SUCCESS", "deleted": bool(task.delete_delivered)}
            if not photo.delivery_hash:
                raise ValueError("照片没有已交付的精修版本")
            if task and task.state != "SUCCESS":
                if task.delete_delivered != delete_delivered:
                    raise ValueError("已有撤回任务正在处理，不能更改删除选项")
            elif task:
                task.operation_id = operation_id
                task.delete_delivered, task.state = delete_delivered, "PENDING"
                task.marker, task.snapshot, task.error = None, None, None
            else:
                s.add(Withdrawal(photo_pk=photo.id, operation_id=operation_id, delete_delivered=delete_delivered))
            s.commit()
        self.wake.set()
        return {"processing": True, "deleted": bool(delete_delivered)}

    async def withdraw_photo(self, event_id, photo_id, delete_delivered):
        # Direct engine callers wait; HTTP uses queue_withdraw and returns a
        # durable receipt before a potentially slow replacement starts.
        async with self.lock:
            self.queue_withdraw(event_id, photo_id, delete_delivered)
            cfg = next(item for item in self.config.projects if item.event_id == event_id)
            with self.sessions() as s:
                project = s.scalar(select(Project).where(Project.event_id == event_id))
                await self.resume_withdrawals(cfg, s, project)
                photo = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == photo_id))
                task = s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id))
                if task.state != "SUCCESS":
                    raise ValueError(task.error or "撤回处理中，系统会自动核对结果")
                return {"deleted": bool(delete_delivered), "current_version": self.current_version(s, photo)}

    async def resume_withdrawals(self, cfg, s, project):
        tasks = list(s.scalars(select(Withdrawal).join(Photo).where(Photo.project_id == project.id, Withdrawal.state != "SUCCESS")))
        for task in tasks:
            photo = s.get(Photo, task.photo_pk)
            try:
                if photo.selected_path:
                    selected = Path(photo.selected_path)
                    if selected.exists() or selected.is_symlink():
                        safe_file(selected, cfg.selected)
                        if photo.materialized_hash and await asyncio.to_thread(sha256, selected) != photo.materialized_hash:
                            raise ValueError("待精修 RAW 副本已变更，拒绝自动删除")
                if task.delete_delivered:
                    if not task.snapshot:
                        proof_index = await asyncio.to_thread(index_files, cfg.raw, FINAL_EXTENSIONS, {"PixCakeDelivery"})
                        proof = match_raw(photo.source_filename, proof_index, cfg.raw)
                        directory = cfg.history / str(photo.photo_id)
                        if directory.is_symlink():
                            raise ValueError("历史目录不能为符号链接")
                        directory.mkdir(parents=True, exist_ok=True)
                        staged = directory / ("withdraw-" + uuid.uuid4().hex + proof.suffix.lower())
                        digest = await asyncio.to_thread(snapshot, proof, staged, self.config.max_bytes)
                        task.snapshot = str(staged)
                        task.marker = f"{Path(photo.source_filename).stem}.__bridge_{digest}{proof.suffix.lower()}"
                        safe_name(task.marker)
                        s.commit()
                    if task.state in {"UPLOADING", "UNKNOWN"}:
                        remote = await self.client.photos(cfg.event_id)
                        current = next((row for row in remote if row["id"] == photo.photo_id), None)
                        if current and current.get("original_filename") == task.marker:
                            task.state = "CLEANUP"
                            s.commit()
                        else:
                            raise ValueError("撤回替换结果未知，已停止重复上传，请摄影师核对")
                    if task.state in {"PENDING", "FAILED"}:
                        safe_file(Path(task.snapshot), cfg.history)
                        task.state, task.updated = "UPLOADING", now()
                        s.commit()
                        try:
                            await self.client.replace(cfg.event_id, photo.photo_id, Path(task.snapshot), task.marker)
                        except ApiError as exc:
                            task.state = "UNKNOWN" if exc.uncertain else "PENDING"
                            s.commit()
                            raise
                        except Exception:
                            task.state = "UNKNOWN"
                            s.commit()
                            raise
                        task.state = "CLEANUP"
                        s.commit()
                    rendered = (await asyncio.to_thread(index_files, cfg.final, FINAL_EXTENSIONS)).get(stem_key(photo.source_filename), [])
                    deliveries = list(s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id)))
                    # Preflight every file before deleting any of them.
                    for row in deliveries:
                        file = Path(row.snapshot)
                        if file.exists() or file.is_symlink():
                            safe_file(file, cfg.history)
                    for file in rendered:
                        safe_file(file, cfg.final)
                    for file in rendered:
                        file.unlink()
                    for row in deliveries:
                        Path(row.snapshot).unlink(missing_ok=True)
                        row.state, row.error, row.updated = "WITHDRAWN", None, now()
                    photo.delivery_hash = None
                    photo.remote_filename = task.marker
                    photo.added_during_editing = False
                    photo.cancelled = False
                else:
                    photo.cancelled = True
                self._remove_selected_raw(cfg, photo)
                photo.selected, photo.error = False, None
                task.state, task.error, task.updated = "SUCCESS", None, now()
                s.commit()
                if task.snapshot:
                    file = Path(task.snapshot)
                    if file.exists():
                        safe_file(file, cfg.history)
                        file.unlink()
            except Exception as exc:
                task.error, task.updated = str(exc), now()
                self.record_error(s, project, f"照片 {photo.photo_id} 撤回待处理: {exc}")
                s.commit()

    async def finals(self, s, cfg, project, counts, remote_ids):
        failed = False
        version_indexes = {}
        legacy_index = None
        for photo in s.scalars(select(Photo).where(Photo.project_id == project.id)):
            if s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id, Withdrawal.state != "SUCCESS")):
                continue
            if not (photo.selected or photo.selected_path) or photo.error or photo.photo_id not in remote_ids:
                continue
            try:
                # Resolve every outstanding upload before considering a newer
                # FINAL version. A changed file must not bypass ambiguity.
                uncertain = list(s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id, Delivery.state == "UNKNOWN")))
                blocked = False
                for previous in uncertain:
                    if photo.remote_filename == previous.marker:
                        self.success(s, cfg, photo, previous)
                    else:
                        blocked = True
                if blocked:
                    self.record_error(s, project, f"照片 {photo.photo_id}: 旧版本上传结果未知，先核对 PicPeak 后再重试")
                    failed = True
                    continue
                # Preserve an edit already in progress when the customer
                # withdraws before the first delivery. After delivery, a
                # withdrawal blocks new revisions until the photo is selected
                # again, while keeping the delivered image and its history.
                if photo.cancelled and photo.delivery_hash:
                    continue
                key = stem_key(photo.source_filename)
                version = self.current_version(s, photo) + 1
                version_dir = self.output_folder(cfg, version)
                if version not in version_indexes:
                    version_indexes[version] = await asyncio.to_thread(index_files, version_dir, FINAL_EXTENSIONS) if version_dir.is_dir() else {}
                candidates = list(version_indexes[version].get(key, []))
                # Keep compatibility with projects that exported their first
                # delivery directly into 04_FINAL before version folders were
                # introduced. A V1 export always wins when it exists alone.
                if version == 1:
                    if legacy_index is None:
                        legacy_index = await asyncio.to_thread(index_files, cfg.final, FINAL_EXTENSIONS)
                    legacy = [p for p in legacy_index.get(key, []) if p.parent == cfg.final]
                    candidates.extend(legacy)
                if not candidates:
                    continue
                if len(candidates) != 1 or counts[key] != 1:
                    raise ValueError("FINAL 或 Proof 同 stem 冲突")
                source = candidates[0]
                safe_file(source, cfg.final)
                if not self.stability.ready(source):
                    continue
                if source.stat().st_size > self.config.max_bytes:
                    raise ValueError("FINAL 超过 100MB/配置上传限制")
                digest = await asyncio.to_thread(sha256, source)
                if digest == photo.delivery_hash:
                    continue
                # Preserve a verified immutable snapshot BEFORE any remote
                # upload; editor may continue exporting to the same filename.
                directory = cfg.history / str(photo.photo_id)
                if directory.is_symlink():
                    raise ValueError("历史目录不能为符号链接")
                directory.mkdir(parents=True, exist_ok=True)
                staged = directory / ("pending-" + uuid.uuid4().hex + source.suffix.lower())
                digest = await asyncio.to_thread(snapshot, source, staged, self.config.max_bytes)
                delivery = s.scalar(select(Delivery).where(Delivery.photo_pk == photo.id, Delivery.sha256 == digest))
                if delivery is None:
                    # Marker is recoverable via the existing Public API, so a
                    # response lost after commit can be reconciled on restart.
                    marker = f"{Path(photo.source_filename).stem}.__bridge_{digest}{source.suffix.lower()}"
                    safe_name(marker)
                    delivery = Delivery(photo_pk=photo.id, sha256=digest, marker=marker, snapshot=str(staged))
                    s.add(delivery)
                elif delivery.state == "SUCCESS":
                    # A byte-identical render was already delivered for this
                    # photo. Keep the existing remote version instead of
                    # uploading the same content again from a later folder.
                    staged.unlink()
                    continue
                else:
                    if Path(delivery.snapshot).is_file():
                        staged.unlink()
                    else:
                        delivery.snapshot = str(staged)
                s.commit()
                if photo.remote_filename == delivery.marker:
                    self.success(s, cfg, photo, delivery)
                    continue
                if delivery.state == "UNKNOWN":
                    # Exactly-once cannot be guaranteed without upstream
                    # idempotency keys. Never retry an ambiguous upload until
                    # a human has checked the remote and requested retry.
                    self.record_error(s, project, f"照片 {photo.photo_id}: 上传结果未知，先核对 PicPeak 后再重试")
                    failed = True
                    continue
                if delivery.state == "FAILED":
                    failed = True
                    continue
                delivery.state, delivery.updated = "UPLOADING", now()
                delivery.attempts += 1
                s.commit()  # durable upload intent
                try:
                    safe_file(Path(delivery.snapshot), cfg.history)
                    if await asyncio.to_thread(sha256, Path(delivery.snapshot)) != digest:
                        raise ValueError("历史快照校验失败")
                    await self.client.replace(cfg.event_id, photo.photo_id, Path(delivery.snapshot), delivery.marker)
                except ApiError as exc:
                    delivery.error, delivery.updated = str(exc), now()
                    delivery.state = "UNKNOWN" if exc.uncertain else ("PENDING" if exc.status == 429 else "FAILED")
                    self.record_error(s, project, f"照片 {photo.photo_id}: {exc}")
                    failed = True
                    s.commit()
                except Exception as exc:
                    delivery.state, delivery.error, delivery.updated = "UNKNOWN", type(exc).__name__, now()
                    self.record_error(s, project, f"照片 {photo.photo_id}: 上传结果未知")
                    failed = True
                    s.commit()
                else:
                    self.success(s, cfg, photo, delivery)
            except (OSError, ValueError) as exc:
                failed = True
                photo.error = str(exc)
                self.record_error(s, project, f"照片 {photo.photo_id}: {exc}")
                s.commit()
        return failed

    def success(self, s, cfg, photo, delivery):
        photo.delivery_hash, photo.remote_filename = delivery.sha256, delivery.marker
        delivery.state, delivery.error, delivery.updated = "SUCCESS", None, now()
        s.commit()
        rows = list(s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id, Delivery.state == "SUCCESS").order_by(Delivery.updated.desc())))
        for old in rows[self.config.history_keep:]:
            p = Path(old.snapshot)
            if p.exists():
                safe_file(p, cfg.history)
                p.unlink()
        # A crash during snapshot->DB commit can leave an unreferenced staged
        # file; cleanup only the per-photo Bridge-owned history namespace.
        referenced = {d.snapshot for d in s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id))}
        directory = cfg.history / str(photo.photo_id)
        for p in directory.glob("pending-*"):
            if str(p) not in referenced and p.is_file() and not p.is_symlink():
                p.unlink()

    def retry(self, event_id):
        with self.sessions() as s:
            photo_ids = select(Photo.id).join(Project).where(Project.event_id == event_id)
            for delivery in s.scalars(select(Delivery).where(Delivery.photo_pk.in_(photo_ids), Delivery.state.in_(["FAILED", "UNKNOWN"]))):
                delivery.state, delivery.error = "PENDING", None
            for task in s.scalars(select(Withdrawal).where(Withdrawal.photo_pk.in_(photo_ids), Withdrawal.state != "SUCCESS")):
                if task.state in {"UNKNOWN", "UPLOADING", "FAILED"}:
                    task.state = "PENDING"
                task.error = None
            s.commit()
        self.wake.set()

    async def loop(self):
        while True:
            self.wake.clear()
            await self.sync()
            try:
                await asyncio.wait_for(self.wake.wait(), self.config.poll_seconds)
            except TimeoutError:
                pass
