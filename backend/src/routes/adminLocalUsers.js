'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { validatePassword } = require('../utils/passwordValidation');
const router = express.Router();
router.use(adminAuth, requireSuperAdmin());
router.get('/', async (req, res, next) => {
  try {
    const users = await db('admin_users').leftJoin('roles', 'roles.id', 'admin_users.role_id')
      .select('admin_users.id', 'admin_users.username', 'admin_users.is_active', 'roles.display_name as role');
    const roles = await db('roles').select('id', 'name', 'display_name');
    res.json({ users, roles });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { username, password, role_id } = req.body;
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,50}$/u.test(username)) return res.status(400).json({ error: '用户名需为 3–50 位字母、数字、下划线或短横线' });
    if (typeof password !== 'string' || password.length > 128 || !validatePassword(password).valid) return res.status(400).json({ error: '密码不满足安全要求' });
    if (!Number.isSafeInteger(Number(role_id)) || !await db('roles').where('id', role_id).first()) return res.status(400).json({ error: '请选择有效角色' });
    // `admin_users.email` is a legacy non-null database column. Store an
    // internal invalid-domain placeholder; it is never used for login or shown.
    const user = { username, email: `${username}@local.invalid`, password_hash: await bcrypt.hash(password, 12), role_id: Number(role_id), is_active: true, must_change_password: true, created_at: new Date(), updated_at: new Date() };
    const result = await db('admin_users').insert(user).returning('id');
    res.status(201).json({ id: result[0]?.id || result[0], username });
  } catch (err) {
    if (/unique|duplicate/i.test(String(err.message))) return res.status(409).json({ error: '用户名已存在' });
    next(err);
  }
});
module.exports = router;
