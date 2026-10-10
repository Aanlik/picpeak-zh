'use strict';

const express = require('express');
const { adminAuth } = require('../middleware/auth');
const { getUserPermissions } = require('../middleware/permissions');

const router = express.Router();

// The admin client uses this read-only endpoint to build its permission-aware
// navigation and route guards. Keep it even though the retired admin user CRUD
// and invitation endpoints have been removed.
router.get('/me/permissions', adminAuth, async (req, res) => {
  try {
    res.json(await getUserPermissions(req.admin.id));
  } catch {
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

module.exports = router;
