'use strict';

const express = require('express');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { requireEventOwnership } = require('../middleware/ownership');
const feedbackService = require('../services/feedbackService');
const {
  validateEventId,
  validateFeedbackSettings,
  checkValidation,
} = require('../utils/feedbackValidation');

const router = express.Router();

// Project settings and photographer review are part of the photo-selection
// workflow.
router.get('/events/:eventId/feedback-settings',
  adminAuth,
  requirePermission('events.view'),
  requireEventOwnership,
  validateEventId,
  checkValidation,
  async (req, res) => {
    try {
      const settings = await feedbackService.getEventFeedbackSettings(req.params.eventId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get feedback settings' });
    }
  }
);

router.put('/events/:eventId/feedback-settings',
  adminAuth,
  requirePermission('events.edit'),
  requireEventOwnership,
  validateEventId,
  validateFeedbackSettings,
  checkValidation,
  async (req, res) => {
    try {
      const settings = await feedbackService.updateEventFeedbackSettings(req.params.eventId, req.body);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update feedback settings' });
    }
  }
);

router.get('/events/:eventId/feedback',
  adminAuth,
  requirePermission('events.view'),
  requireEventOwnership,
  validateEventId,
  checkValidation,
  async (req, res) => {
    try {
      const eventId = Number(req.params.eventId);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const limit = Number.parseInt(req.query.limit, 10) || 50;
      const photoId = req.query.photoId == null ? null : Number.parseInt(req.query.photoId, 10);
      if (page < 1 || limit < 1 || limit > 100 || (photoId !== null && (!Number.isSafeInteger(photoId) || photoId < 1))) {
        return res.status(400).json({ error: 'Invalid feedback query parameters' });
      }

      const query = db('photo_feedback')
        .join('photos', 'photo_feedback.photo_id', 'photos.id')
        .where('photo_feedback.event_id', eventId)
        .select('photo_feedback.*', 'photos.filename', 'photos.path');
      const countQuery = db('photo_feedback').where('photo_feedback.event_id', eventId);

      if (req.query.type) {
        query.where('photo_feedback.feedback_type', req.query.type);
        countQuery.where('photo_feedback.feedback_type', req.query.type);
      }
      if (photoId !== null) {
        query.where('photo_feedback.photo_id', photoId);
        countQuery.where('photo_feedback.photo_id', photoId);
      }
      if (req.query.status === 'hidden') {
        query.where('photo_feedback.is_hidden', true);
        countQuery.where('photo_feedback.is_hidden', true);
      }

      const countRow = await countQuery.count('photo_feedback.id as count').first();
      const total = Number(countRow?.count || 0);
      const feedback = await query
        .orderBy('photo_feedback.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

      res.json({
        feedback,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get feedback' });
    }
  }
);

module.exports = router;
