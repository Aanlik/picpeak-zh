const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/version', adminAuth, requirePermission(['settings.view', 'system.view']), async (_req, res) => {
  try {
    const packagePath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    const { isSingleContainerImage } = require('../services/faceSettings');
    res.json({
      backend: packageJson.version || '1.0.0',
      frontend: '1.0.0',
      node: process.version,
      environment: process.env.NODE_ENV || 'production',
      single_container: isSingleContainerImage(),
    });
  } catch (error) {
    logger.error('Error fetching version:', error);
    res.status(500).json({ error: 'Failed to fetch version information' });
  }
});

// Runtime health only.
router.get('/status', adminAuth, requirePermission(['settings.view', 'system.view']), (_req, res) => {
  const cpus = os.cpus();
  res.json({
    system: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
      cpu: { model: cpus[0]?.model || 'Unknown', cores: cpus.length },
    },
    services: {
      fileWatcher: { status: 'active' },
      expirationChecker: { status: 'active' },
    },
    timestamp: new Date(),
  });
});

module.exports = router;
