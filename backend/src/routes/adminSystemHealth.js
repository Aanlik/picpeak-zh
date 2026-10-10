const express = require('express');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { handleAsync, successResponse } = require('../utils/routeHelpers');
const { getCoverageReport } = require('../services/backupCoverageService');

const router = express.Router();
router.use(adminAuth);

router.get(
  '/backup-coverage',
  requirePermission(['settings.view', 'system.view']),
  handleAsync(async (_req, res) => successResponse(res, { report: await getCoverageReport() })),
);

module.exports = router;
