// Read-only internal proxy. Photography business state remains in Bridge.
const express = require('express');
const { requireEventOwnership } = require('../middleware/ownership');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { NO_EMAIL_MODE } = require('../utils/communicationProfile');
const router = express.Router();
router.use(adminAuth, requirePermission('events.view'));
router.get('/:eventId', (req, res, next) => /^\d+$/.test(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  if (!/^\d+$/.test(req.params.eventId)) return res.sendStatus(400);
  const base = process.env.PIXCAKE_BRIDGE_URL;
  const password = process.env.PIXCAKE_BRIDGE_PASSWORD;
  if (!base || !password) return res.status(503).json({ error: '尚未连接精修同步服务' });
  try {
    const response = await fetch(new URL('/api/projects', base), {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Bridge unavailable');
    const projects = await response.json();
    const project = projects.find(p => String(p.event_id) === req.params.eventId);
    if (!project) return res.status(404).json({ error: '此项目尚未关联精修同步服务' });
    res.json(project);
  } catch { res.status(503).json({ error: '精修同步服务暂时不可用' }); }
});
module.exports = router;
