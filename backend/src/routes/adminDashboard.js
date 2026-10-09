const express = require('express');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { seesAllEvents } = require('../middleware/ownership');
const { sanitizeDays } = require('../utils/sqlSecurity');
const { formatBoolean, whereTimestamp } = require('../utils/dbCompat');
const { resolveAdapter } = require('../services/trackers');
const logger = require('../utils/logger');
const { errorResponse, getPagination } = require('../utils/routeHelpers');
const { measureLocalStorageUsage } = require('../services/localStorageUsage');
const { queueTimestamp, toUtcIso } = require('../utils/queueTimestamps');
const router = express.Router();

/**
 * Normalise a value coming back from `DATE(timestamp)` into a YYYY-MM-DD
 * string. SQLite returns this column as a string already; Postgres' pg
 * driver auto-converts it to a JavaScript Date object, which broke the
 * old `dateObj.date === row.date` merge below — every Postgres install saw
 * an all-zero `chartData[]` even with real traffic (#661 Bug A). Always
 * normalise before comparing.
 */
function normaliseDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Strings might arrive with time component, slice defensively.
  return String(value).slice(0, 10);
}

/**
 * Event ids the caller's dashboard may aggregate over, or `null` when the
 * caller is unrestricted (GHSA-c2jj / gqx7 / jhcf).
 *
 * These endpoints are gated only by `analytics.view`, which scoped roles such
 * as `editor` hold — yet the events *list* restricts those roles to their own
 * events plus ownerless ones (ownership.scopeEventsListQuery). The dashboard
 * therefore reported instance-wide totals, and the analytics endpoint returned
 * other admins' gallery names and slugs, to a role that cannot see those
 * events anywhere else.
 *
 * Scoped with seesAllEvents to mirror the events list exactly, so the
 * super_admin and `admin` dashboards stay instance-wide.
 *
 * @returns {Promise<number[]|null>} ids to restrict to, or null for no limit
 */
function isScopedAdmin(admin) {
  // Mirrors the events list: every role except super_admin and admin is
  // limited to its own events plus ownerless ones.
  return !seesAllEvents(admin);
}

/**
 * Restrict `query` to the caller's own events.
 *
 * Uses a SUBQUERY rather than materialising the id list. An editor owning more
 * events than the driver's bind-parameter limit (~999 on SQLite, 65535 on
 * Postgres) would otherwise blow past it once every id became a placeholder,
 * turning all three dashboard endpoints into 500s — and even well below that
 * limit the whole list was re-sent for each of the ~10 aggregates per request.
 */
function applyEventScope(query, admin, column) {
  if (!isScopedAdmin(admin)) return query;
  return query.whereIn(column, db('events').select('id')
    .where((q) => q.whereNull('created_by').orWhere('created_by', admin.id)));
}

// Get dashboard statistics
router.get('/stats', adminAuth, requirePermission('analytics.view'), async (req, res) => {
  try {
    // Get active events count
    const activeEvents = await applyEventScope(db('events'), req.admin, 'id')
      .where('is_active', formatBoolean(true))
      .where('is_archived', formatBoolean(false))
      .count('id as count')
      .first();

    // Get events expiring within 7 days
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const now = new Date();
    
    // Same mixed-shape comparison as the events list's status=expiring
    // (issue 1733): the tile and the list it sits next to must agree.
    const expiringEvents = await applyEventScope(db('events'), req.admin, 'id')
      .where('is_active', formatBoolean(true))
      .where('is_archived', formatBoolean(false))
      .modify(whereTimestamp, 'expires_at', '<=', sevenDaysFromNow)
      .modify(whereTimestamp, 'expires_at', '>', now)
      .count('id as count')
      .first();

    // Get total photos count
    const totalPhotos = await applyEventScope(db('photos'), req.admin, 'event_id')
      .count('id as count')
      .first();

    // The catalogued size of the ORIGINALS. Kept, and still worth showing —
    // it answers "how much photography is in here" — but it is emphatically
    // NOT storage used, which is what it was labelled for years (#1164).
    const catalogedBytes = await applyEventScope(db('photos'), req.admin, 'event_id')
      .sum('size_bytes as total')
      .first();

    // Storage used: what is actually on this machine. In reference mode the
    // originals above live on a NAS and contribute nothing here; conversely
    // this counts what the sum never did — thumbnails, previews, hero
    // renditions and the per-event download cache.
    //
    // Deliberately NOT event-scoped, unlike everything else on this endpoint:
    // it is a disk measurement, and disk is not divisible by which admin owns
    // which event. A scoped admin gets the same number a super_admin does,
    // which is the honest answer to "is this box running out of space" and
    // leaks nothing beyond the aggregate they can already infer from the
    // system-health page.
    // Skipped entirely on an S3 backend: the objects are in the bucket and a
    // walk of STORAGE_PATH would report near-zero, which is worse than the
    // catalogued figure those installs had before #1164. `storageUsed` is null
    // there and the tile shows the catalogued number it already carries.
    const usesLocalBackend = (process.env.STORAGE_BACKEND || 'local').toLowerCase() !== 's3';
    let localStorage = null;
    try {
      if (usesLocalBackend) localStorage = await measureLocalStorageUsage();
    } catch (err) {
      // The dashboard must render without it; the tile falls back to showing
      // the catalogued figure, labelled as such.
      logger.warn(`Dashboard storage measurement failed: ${err.message}`);
    }

    // Get total views (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const totalViews = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .where('action', 'view')
      .where('timestamp', '>=', thirtyDaysAgo.toISOString())
      .count('id as count')
      .first();

    // Get total downloads (last 30 days) - include both single and bulk downloads
    const totalDownloads = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .whereIn('action', ['download', 'download_all', 'download_all_presigned', 'download_selected'])
      .where('timestamp', '>=', thirtyDaysAgo.toISOString())
      .count('id as count')
      .first();

    // Get archived events count
    const archivedEvents = await applyEventScope(db('events'), req.admin, 'id')
      .where('is_archived', formatBoolean(true))
      .count('id as count')
      .first();

    // Get total events count (all events regardless of status) — used by the
    // events list page to render accurate "All (N)" / Total Events counters
    // when the table is server-paginated (#346).
    const totalEvents = await applyEventScope(db('events'), req.admin, 'id')
      .count('id as count')
      .first();

    // Calculate trends (compare with previous 30 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    const previousViews = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .where('action', 'view')
      .where('timestamp', '>=', sixtyDaysAgo.toISOString())
      .where('timestamp', '<', thirtyDaysAgo.toISOString())
      .count('id as count')
      .first();

    const previousDownloads = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .whereIn('action', ['download', 'download_all', 'download_all_presigned', 'download_selected'])
      .where('timestamp', '>=', sixtyDaysAgo.toISOString())
      .where('timestamp', '<', thirtyDaysAgo.toISOString())
      .count('id as count')
      .first();

    // Calculate trend percentages
    const viewsTrend = previousViews.count > 0 
      ? ((totalViews.count - previousViews.count) / previousViews.count) * 100 
      : 0;
    
    const downloadsTrend = previousDownloads.count > 0
      ? ((totalDownloads.count - previousDownloads.count) / previousDownloads.count) * 100
      : 0;

    res.json({
      activeEvents: activeEvents.count || 0,
      expiringEvents: expiringEvents.count || 0,
      totalPhotos: totalPhotos.count || 0,
      // Real bytes on this disk. Null when the measurement failed, which the
      // UI shows as "unavailable" rather than substituting a number that
      // means something else.
      storageUsed: localStorage ? localStorage.total : null,
      // Three states, not two: 'catalog' means the backend is S3 and the
      // objects are in the bucket, which is a fact about the install;
      // 'unavailable' means the walk failed, which is a fault. Collapsing them
      // made a failed local measurement claim the objects live in S3.
      storageMeasurement: localStorage ? 'disk' : (usesLocalBackend ? 'unavailable' : 'catalog'),
      storageBreakdown: localStorage ? localStorage.breakdown : null,
      // True when part of the storage root could not be read, so the total is
      // a floor rather than the answer.
      storagePartial: localStorage ? localStorage.partial : false,
      // Catalogued original bytes — what `storageUsed` used to report (#1164).
      catalogedBytes: Number(catalogedBytes.total) || 0,
      totalViews: totalViews.count || 0,
      totalDownloads: totalDownloads.count || 0,
      viewsTrend: Math.round(viewsTrend * 10) / 10,
      downloadsTrend: Math.round(downloadsTrend * 10) / 10,
      archivedEvents: archivedEvents.count || 0,
      totalEvents: totalEvents.count || 0
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to fetch dashboard statistics');
  }
});

// Get recent activity
router.get('/activity', adminAuth, requirePermission('analytics.view'), async (req, res) => {
  try {
    const { limit } = getPagination(req, { limit: 10 });

    // Scope the feed to the caller's own events (GHSA-jhcf) — it otherwise
    // returned every admin's actions, including actor names and verbatim
    // metadata. `activity_logs.event_id` is NULLABLE: system-level entries
    // (logins, settings changes) carry no event, and those are deliberately
    // EXCLUDED for a scoped caller rather than shown, since they are exactly
    // the cross-admin actions this advisory is about.
    const activities = await applyEventScope(
      db('activity_logs')
        .select('activity_logs.*', 'events.event_name')
        .leftJoin('events', 'activity_logs.event_id', 'events.id'),
      req.admin,
      'activity_logs.event_id'
    )
      .orderBy('activity_logs.created_at', 'desc')
      .limit(limit);

    // Format activities
    const formattedActivities = activities.map(activity => ({
      id: activity.id,
      type: activity.activity_type,
      actorType: activity.actor_type,
      actorName: activity.actor_name,
      eventName: activity.event_name,
      metadata: (() => {
        try {
          if (!activity.metadata) return {};
          if (typeof activity.metadata === 'object') return activity.metadata;
          return JSON.parse(activity.metadata);
        } catch (e) {
          logger.warn('Failed to parse metadata for activity:', activity.id, e.message);
          return {};
        }
      })(),
      // Zone-less UTC from the column default on SQLite; see toUtcIso.
      createdAt: toUtcIso(activity.created_at)
    }));

    res.json(formattedActivities);
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to fetch activity log');
  }
});

// Get system health status
router.get('/health', adminAuth, requirePermission('settings.view'), async (req, res) => {
  try {
    const os = require('os');
    
    // Check database connectivity
    let dbStatus = 'healthy';
    try {
      await db.raw('SELECT 1');
    } catch (error) {
      dbStatus = 'error';
    }

    // Check email queue
    const [pendingEmails] = await db('email_queue')
      .where('status', 'pending')
      .count('* as count');
    
    // Failures of the last day, by created_at: scheduled_at is NULL for mail
    // that was to go out at once (issue 1670). The bind is engine-shaped — a
    // Date on Postgres, epoch ms on SQLite — so it compares on both.
    const [failedEmails] = await db('email_queue')
      .where('status', 'failed')
      .where('created_at', '>=', queueTimestamp(Date.now() - 24 * 60 * 60 * 1000))
      .count('* as count');

    const emailStatus = failedEmails.count > 10 ? 'warning' : 'healthy';

    // Check disk space (simplified)
    const storageStatus = 'healthy'; // In production, check actual disk usage

    // Memory usage
    const memoryUsage = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      percentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    };

    const memoryStatus = memoryUsage.percentage > 90 ? 'warning' : 'healthy';

    // Overall health
    const statuses = [dbStatus, emailStatus, storageStatus, memoryStatus];
    let overallHealth = 'healthy';
    if (statuses.includes('error')) overallHealth = 'error';
    else if (statuses.includes('warning')) overallHealth = 'warning';

    res.json({
      overall: overallHealth,
      services: {
        database: dbStatus,
        email: emailStatus,
        storage: storageStatus,
        memory: memoryStatus
      },
      details: {
        emailQueue: {
          pending: pendingEmails.count,
          failed: failedEmails.count
        },
        memory: memoryUsage
      }
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({ 
      overall: 'error',
      error: 'Failed to check system health' 
    });
  }
});

// Get analytics data for charts
router.get('/analytics', adminAuth, requirePermission('analytics.view'), async (req, res) => {
  try {
    const days = sanitizeDays(req.query.days || 7);

    // Generate date range
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      dates.push({
        date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        views: 0,
        downloads: 0,
        uniqueVisitors: 0
      });
    }

    // Calculate the start date for queries
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    // Get views per day
    const viewsData = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .select(db.raw('DATE(timestamp) as date'), db.raw('COUNT(*) as count'))
      .where('action', 'view')
      .where('timestamp', '>=', startDateStr)
      .groupByRaw('DATE(timestamp)');

    // Get downloads per day - include both single and bulk downloads
    const downloadsData = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .select(db.raw('DATE(timestamp) as date'), db.raw('COUNT(*) as count'))
      .whereIn('action', ['download', 'download_all', 'download_all_presigned', 'download_selected'])
      .where('timestamp', '>=', startDateStr)
      .groupByRaw('DATE(timestamp)');

    // Get unique visitors per day
    const visitorsData = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .select(db.raw('DATE(timestamp) as date'), db.raw('COUNT(DISTINCT ip_address) as count'))
      .where('timestamp', '>=', startDateStr)
      .groupByRaw('DATE(timestamp)');

    // Merge data into dates array. row.date is normalised because Postgres
    // returns DATE() as a JS Date while SQLite returns a string (#661 Bug A).
    // Counts come back as strings on Postgres too, so coerce via Number.
    viewsData.forEach(row => {
      const key = normaliseDateKey(row.date);
      const dateObj = dates.find(d => d.date === key);
      if (dateObj) dateObj.views = Number(row.count) || 0;
    });

    downloadsData.forEach(row => {
      const key = normaliseDateKey(row.date);
      const dateObj = dates.find(d => d.date === key);
      if (dateObj) dateObj.downloads = Number(row.count) || 0;
    });

    visitorsData.forEach(row => {
      const key = normaliseDateKey(row.date);
      const dateObj = dates.find(d => d.date === key);
      if (dateObj) dateObj.uniqueVisitors = Number(row.count) || 0;
    });

    // Get top galleries by views with additional metrics. The camelCase
    // alias is quoted because Postgres folds an unquoted identifier to
    // lower case, and the frontend reads `uniqueVisitors`, not `uniquevisitors`.
    const topGalleries = await applyEventScope(db('access_logs'), req.admin, 'access_logs.event_id')
      .select('events.id', 'events.event_name', 'events.slug')
      .select(db.raw('COUNT(CASE WHEN action = \'view\' THEN 1 END) as views'))
      .select(db.raw('COUNT(DISTINCT CASE WHEN action = \'view\' THEN ip_address END) as "uniqueVisitors"'))
      .select(db.raw('COUNT(CASE WHEN action IN (\'download\', \'download_all\', \'download_all_presigned\', \'download_selected\') THEN 1 END) as downloads'))
      .join('events', 'access_logs.event_id', 'events.id')
      .where('access_logs.timestamp', '>=', startDateStr)
      .groupBy('events.id', 'events.event_name', 'events.slug')
      .orderBy('views', 'desc')
      .limit(5);

    // Device breakdown — prefer the operator's analytics tracker (Umami /
    // Rybbit) when configured (#661 Bug C + #663 Phase 1). The local
    // access_logs heuristic below produces 0% on installs where guest user
    // agents don't reliably contain "Mobile" / "Tablet" tokens; the tracker
    // adapters track devices natively. Falls back to access_logs when no
    // tracker is configured (provider=none/custom), the upstream call fails,
    // or the response shape doesn't match what we expect.
    let devices = { desktop: 0, mobile: 0, tablet: 0 };
    let devicesSource = 'access_logs';

    // The external tracker reports instance-wide device data with no way to
    // filter it by event, so a scoped caller must not receive it (GHSA-gqx7).
    // They fall through to the access_logs heuristic, which IS scoped.
    const adapter = isScopedAdmin(req.admin) ? null : await resolveAdapter();
    if (adapter) {
      try {
        const trackerDevices = await adapter.fetchDeviceBreakdown({
          startMs: startDate.getTime(),
          endMs: Date.now(),
        });
        if (trackerDevices) {
          devices = trackerDevices;
          devicesSource = adapter.provider;
        }
      } catch (err) {
        logger.warn(`Analytics: ${adapter.provider} device-breakdown fetch failed; falling back to access_logs`, {
          error: err.message,
        });
      }
    }

    if (devicesSource === 'access_logs') {
      // Local heuristic on access_logs user_agent. Coarse — `LIKE` doesn't
      // cover every UA shape (some Android browsers, embedded webviews, etc.)
      // — and counts come back as strings on Postgres, hence Number() below.
      const deviceData = await applyEventScope(db('access_logs'), req.admin, 'event_id')
        .select(
          db.raw(`
            CASE
              WHEN user_agent LIKE '%Mobile%' THEN 'mobile'
              WHEN user_agent LIKE '%Tablet%' OR user_agent LIKE '%iPad%' THEN 'tablet'
              ELSE 'desktop'
            END as device_type
          `),
          db.raw('COUNT(*) as count')
        )
        .where('timestamp', '>=', startDateStr)
        .whereNotNull('user_agent')
        .groupBy('device_type');

      const totalDevices = deviceData.reduce((sum, d) => sum + (Number(d.count) || 0), 0);
      if (totalDevices > 0) {
        deviceData.forEach(d => {
          devices[d.device_type] = Math.round(((Number(d.count) || 0) / totalDevices) * 100);
        });
      }
    }

    // Calculate totals for the period (matching /stats logic)
    const totalViews = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .where('action', 'view')
      .where('timestamp', '>=', startDateStr)
      .count('id as count')
      .first();

    const totalDownloadsCount = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .whereIn('action', ['download', 'download_all', 'download_all_presigned', 'download_selected'])
      .where('timestamp', '>=', startDateStr)
      .count('id as count')
      .first();

    const totalUniqueVisitors = await applyEventScope(db('access_logs'), req.admin, 'event_id')
      .where('timestamp', '>=', startDateStr)
      .countDistinct('ip_address as count')
      .first();

    res.json({
      chartData: dates,
      topGalleries,
      devices,
      devicesSource,
      totals: {
        views: totalViews?.count || 0,
        downloads: totalDownloadsCount?.count || 0,
        uniqueVisitors: totalUniqueVisitors?.count || 0
      }
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to fetch analytics data');
  }
});

module.exports = router;
