/**
 * Role and permission management for local admin accounts.
 * Admin accounts use local usernames and role assignments.
 */
const { db, logActivity } = require('../database/db');
const logger = require('../utils/logger');
const { ConflictError, NotFoundError, ValidationError, ForbiddenError } = require('../utils/errors');

// System roles that ship with the app. Their `name` (the semantic key routes
// check) is immutable and they cannot be deleted; their display/description and
// (except super_admin) their permission set may be tweaked.
const RESERVED_ROLE_NAMES = ['super_admin', 'admin', 'editor', 'viewer', 'solo_photographer', 'team_photographer'];

function clearPermCache() {
  // Bust the RBAC middleware cache so grant changes take effect immediately
  // rather than waiting out its 60s TTL. Lazy-required to avoid a load cycle.
  try { require('../middleware/permissions').clearPermissionCache(); } catch (_) { /* optional */ }
}

function normalizeRoleName(name) {
  return String(name || '').trim().toLowerCase();
}

async function resolvePermissionIds(permissionNames) {
  const names = Array.from(new Set((permissionNames || []).filter(Boolean)));
  if (names.length === 0) return [];
  const rows = await db('permissions').whereIn('name', names).select('id', 'name');
  const found = new Set(rows.map((r) => r.name));
  const missing = names.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new ValidationError(`Unknown permission(s): ${missing.join(', ')}`);
  }
  return rows.map((r) => r.id);
}

// Contain the roles.manage blast radius (delegation, not root escalation): a
// non-super_admin managing roles may only grant permissions their OWN role
// already holds, so `roles.manage` can't be turned into "grant myself
// everything". super_admin bypasses (it holds the full catalog anyway).
async function assertActorMayGrant(actorId, permissionNames) {
  const names = Array.from(new Set((permissionNames || []).filter(Boolean)));
  if (names.length === 0) return;
  const actor = await db('admin_users')
    .leftJoin('roles', 'roles.id', 'admin_users.role_id')
    .where('admin_users.id', actorId)
    .select('roles.name as role_name')
    .first();
  if (actor && actor.role_name === 'super_admin') return;
  const { userHasAllPermissions } = require('../middleware/permissions');
  if (!(await userHasAllPermissions(actorId, names))) {
    throw new ForbiddenError('You can only grant permissions your own role already holds.');
  }
}

async function getRoleWithPermissionsById(id) {
  const role = await db('roles')
    .where('id', id)
    .select('id', 'name', 'display_name', 'description', 'is_system', 'priority')
    .first();
  if (!role) return null;
  const permissions = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('role_permissions.role_id', id)
    .pluck('permissions.name');
  return { ...role, permissions: permissions.sort() };
}

/**
 * All roles with their permission-name arrays and assigned-user counts. Backs
 * the role-editor list.
 */
async function getRolesWithPermissions() {
  const roles = await db('roles')
    .select('id', 'name', 'display_name', 'description', 'is_system', 'priority')
    .orderBy('priority', 'desc');
  const grants = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('role_permissions.role_id as role_id', 'permissions.name as name');
  const userCounts = await db('admin_users')
    .whereNotNull('role_id')
    .select('role_id')
    .count('* as count')
    .groupBy('role_id');

  const permsByRole = new Map();
  for (const g of grants) {
    if (!permsByRole.has(g.role_id)) permsByRole.set(g.role_id, []);
    permsByRole.get(g.role_id).push(g.name);
  }
  const countByRole = new Map(userCounts.map((r) => [r.role_id, Number(r.count)]));

  return roles.map((r) => ({
    ...r,
    permissions: (permsByRole.get(r.id) || []).sort(),
    user_count: countByRole.get(r.id) || 0,
  }));
}

/**
 * The full permission catalog (for the editor's matrix), ordered by category.
 */
async function getPermissionCatalog() {
  return db('permissions')
    .select('id', 'name', 'display_name', 'category', 'description')
    .orderBy(['category', 'name']);
}

/**
 * Create a custom role with an explicit permission set.
 */
async function createRole({ name, displayName, description, priority, permissions }, createdById) {
  const normalized = normalizeRoleName(name);
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(normalized)) {
    throw new ValidationError('Role name must be lowercase letters, numbers and underscores (2–49 chars, starting with a letter).');
  }
  if (RESERVED_ROLE_NAMES.includes(normalized)) {
    throw new ConflictError(`"${normalized}" is a reserved system role name.`);
  }
  const existing = await db('roles').where('name', normalized).first();
  if (existing) throw new ConflictError(`A role named "${normalized}" already exists.`);

  await assertActorMayGrant(createdById, permissions);
  const permIds = await resolvePermissionIds(permissions);
  const rawPriority = Number(priority);
  const safePriority = Number.isFinite(rawPriority) ? Math.max(0, Math.min(99, Math.floor(rawPriority))) : 50;

  let roleId;
  await db.transaction(async (trx) => {
    const ins = await trx('roles').insert({
      name: normalized,
      display_name: displayName || normalized,
      description: description || null,
      is_system: false,
      priority: safePriority,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }).returning('id');
    roleId = ins[0]?.id ?? ins[0];
    if (permIds.length > 0) {
      await trx('role_permissions').insert(permIds.map((pid) => ({ role_id: roleId, permission_id: pid })));
    }
  });

  clearPermCache();
  // logActivity AFTER commit — a global-db write inside the trx would deadlock
  // on SQLite. See feedback_sqlite_global_write_in_transaction.
  await logActivity('admin_role_created',
    { roleId, name: normalized, permissionCount: permIds.length },
    null,
    { type: 'admin', id: createdById, name: 'system' });
  logger.info('Role created', { roleId, name: normalized, createdById });
  return getRoleWithPermissionsById(roleId);
}

/**
 * Update a role's display/description/priority and/or replace its permission
 * set. super_admin is fully protected; system roles keep their name + priority.
 */
async function updateRole(id, { displayName, description, priority, permissions }, updatedById) {
  const role = await db('roles').where('id', id).first();
  if (!role) throw new NotFoundError('Role', id);
  if (role.name === 'super_admin') {
    throw new ValidationError('The Super Admin role is protected — it always holds every permission and cannot be edited.');
  }

  // Self-amplification guard: a non-super_admin can't edit their OWN role (which
  // would let a roles.manage holder grant their own role more), and can only
  // grant permissions they already hold. See assertActorMayGrant.
  const actor = await db('admin_users')
    .leftJoin('roles', 'roles.id', 'admin_users.role_id')
    .where('admin_users.id', updatedById)
    .select('admin_users.role_id as role_id', 'roles.name as role_name')
    .first();
  const actorIsSuper = actor && actor.role_name === 'super_admin';
  if (!actorIsSuper && actor && actor.role_id === Number(id)) {
    throw new ForbiddenError('You cannot edit your own role.');
  }
  if (permissions !== undefined) {
    await assertActorMayGrant(updatedById, permissions);
  }

  const patch = { updated_at: db.fn.now() };
  if (displayName !== undefined) patch.display_name = displayName;
  if (description !== undefined) patch.description = description;
  if (priority !== undefined && !role.is_system) {
    const p = Number(priority);
    if (Number.isFinite(p)) patch.priority = Math.max(0, Math.min(99, Math.floor(p)));
  }

  let permIds = null;
  if (permissions !== undefined) {
    permIds = await resolvePermissionIds(permissions);
  }

  await db.transaction(async (trx) => {
    await trx('roles').where('id', id).update(patch);
    if (permIds !== null) {
      await trx('role_permissions').where('role_id', id).del();
      if (permIds.length > 0) {
        await trx('role_permissions').insert(permIds.map((pid) => ({ role_id: id, permission_id: pid })));
      }
    }
  });

  clearPermCache();
  await logActivity('admin_role_updated',
    { roleId: id, name: role.name, permissionsChanged: permIds !== null },
    null,
    { type: 'admin', id: updatedById, name: 'system' });
  logger.info('Role updated', { roleId: id, name: role.name, updatedById });
  return getRoleWithPermissionsById(id);
}

/**
 * Delete a custom role. System roles are protected; a role still assigned to
 * users must be reassigned first (avoids leaving users permission-less).
 */
async function deleteRole(id, deletedById) {
  const role = await db('roles').where('id', id).first();
  if (!role) throw new NotFoundError('Role', id);
  if (role.is_system) throw new ValidationError('System roles cannot be deleted.');

  const assigned = await db('admin_users').where('role_id', id).count('* as count').first();
  if (Number(assigned?.count) > 0) {
    throw new ConflictError('Reassign the users holding this role before deleting it.');
  }

  await db.transaction(async (trx) => {
    await trx('role_permissions').where('role_id', id).del();
    await trx('roles').where('id', id).del();
  });

  clearPermCache();
  await logActivity('admin_role_deleted',
    { roleId: id, name: role.name },
    null,
    { type: 'admin', id: deletedById, name: 'system' });
  logger.info('Role deleted', { roleId: id, name: role.name, deletedById });
}

/**
 * Clone any role (including a preset) into a new custom role with the same
 * permission set — the "start from a preset" flow.
 */
async function cloneRole(sourceId, { name, displayName, description }, createdById) {
  const source = await db('roles').where('id', sourceId).first();
  if (!source) throw new NotFoundError('Role', sourceId);
  const permissions = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('role_permissions.role_id', sourceId)
    .pluck('permissions.name');
  return createRole({
    name,
    displayName: displayName || `${source.display_name} copy`,
    description: description !== undefined ? description : source.description,
    priority: source.is_system ? 50 : source.priority,
    permissions,
  }, createdById);
}


module.exports = {
  getRolesWithPermissions,
  getPermissionCatalog,
  getRoleWithPermissionsById,
  createRole,
  updateRole,
  deleteRole,
  cloneRole,
  assertActorMayGrant,
};
