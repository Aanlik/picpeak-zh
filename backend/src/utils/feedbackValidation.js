const { body, param, validationResult } = require('express-validator');
const { safeValidationErrors } = require('./routeHelpers');
const { REACTION_EMOJIS } = require('../constants/reactions');
const { COLOR_LABELS } = require('../constants/colorLabels');
const { KEYBIND_MODES } = require('../services/feedbackDefaults');

/**
 * Validation rules for feedback submission
 */
const feedbackValidationRules = {
  rating: [
    body('feedback_type').equals('rating'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('guest_name')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Name must be less than 100 characters'),
  ],

  like: [
    body('feedback_type').equals('like'),
    body('guest_name')
      .optional()
      .trim()
      .isLength({ max: 100 }),
  ],

  favorite: [
    body('feedback_type').equals('favorite'),
    body('guest_name')
      .optional()
      .trim()
      .isLength({ max: 100 }),
  ],

  comment: [
    body('feedback_type').equals('comment'),
    body('comment_text')
      .trim()
      .notEmpty()
      .withMessage('Comment cannot be empty')
      .isLength({ min: 1, max: 1000 })
      .withMessage('Comment must be between 1 and 1000 characters')
      .customSanitizer(value => sanitizeComment(value)),
    body('guest_name')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Name must be less than 100 characters'),
  ]
};

/**
 * Sanitize comment text
 */
function sanitizeComment(text) {
  if (!text) return '';

  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Remove zero-width characters
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Remove control characters
  // eslint-disable-next-line no-control-regex -- intentional: strips control chars from feedback text
  text = text.replace(/[\x00-\x1F\x7F]/g, '');

  // Limit consecutive special characters
  text = text.replace(/([!?.]){4,}/g, '$1$1$1');

  // Remove script tags and other dangerous HTML (basic sanitization)
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
  text = text.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '');
  text = text.replace(/<embed[^>]*>/gi, '');

  return text;
}

/**
 * Validate feedback type parameter
 */
const validateFeedbackType = param('feedbackType')
  .isIn(['rating', 'like', 'comment', 'favorite'])
  .withMessage('Invalid feedback type');

/**
 * Validate photo ID parameter
 */
const validatePhotoId = param('photoId')
  .isInt({ min: 1 })
  .withMessage('Invalid photo ID');

/**
 * Validate event ID parameter
 */
const validateEventId = param('eventId')
  .isInt({ min: 1 })
  .withMessage('Invalid event ID');

function checkValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', errors: safeValidationErrors(result.array()) });
  }
  return next();
}

// Older galleries may still carry require_name_email=true. Preserve the
// useful part of that setting by requiring the guest's display name; this
// build has no email collection or delivery path.
async function validateGuestRequirements(settings, guestData = {}) {
  if (!settings?.require_name_email) return { valid: true };
  const name = typeof guestData.guest_name === 'string' ? guestData.guest_name.trim() : '';
  if (!name) return { valid: false, errors: ['Name is required'] };
  return { valid: true };
}

/**
 * Get validation rules based on feedback type
 */
function getValidationRules(feedbackType) {
  return feedbackValidationRules[feedbackType] || [];
}

/**
 * Validation middleware for feedback submission
 */
const validateFeedbackSubmission = [
  body('feedback_type')
    .isIn(['rating', 'like', 'comment', 'favorite', 'reaction', 'color_label'])
    .withMessage('Invalid feedback type'),

  // Conditional validation based on feedback type. 0 clears the guest's
  // existing rating (#884). toInt so a numeric string "0" reaches the
  // service as a real 0 and hits the removal path.
  body('rating')
    .if(body('feedback_type').equals('rating'))
    .isInt({ min: 0, max: 5 })
    .withMessage('Rating must be between 0 and 5')
    .toInt(),

  // Reactions (#839): fixed curated set only — no free-form emoji.
  body('reaction')
    .if(body('feedback_type').equals('reaction'))
    .custom((value) => REACTION_EMOJIS.includes(value))
    .withMessage('Invalid reaction'),

  // Colour labels (#1044): Lightroom's five colours only — the value ends up
  // in an XMP field Lightroom parses, so free-form strings are rejected here
  // rather than sanitised later.
  body('color_label')
    .if(body('feedback_type').equals('color_label'))
    .custom((value) => COLOR_LABELS.includes(value))
    .withMessage('Invalid color label'),

  body('comment_text')
    .if(body('feedback_type').equals('comment'))
    .trim()
    .notEmpty()
    .withMessage('Comment cannot be empty')
    .isLength({ min: 1, max: 1000 })
    .withMessage('Comment must be between 1 and 1000 characters')
    .customSanitizer(value => sanitizeComment(value)),

  body('guest_name')
    .optional()
    .custom((value) => {
      // Allow empty or whitespace-only strings
      if (!value || value.trim() === '') return true;
      // If not empty, check length and pattern
      const trimmed = value.trim();
      if (trimmed.length > 100) throw new Error('Name must be less than 100 characters');
      if (!/^[\p{L}\p{M}\p{N} \-'.·]+$/u.test(trimmed)) throw new Error('Name contains invalid characters');
      return true;
    }),

];

/**
 * Validation for feedback settings
 */
const validateFeedbackSettings = [
  body('feedback_enabled').optional().isBoolean(),
  body('allow_ratings').optional().isBoolean(),
  body('allow_likes').optional().isBoolean(),
  body('allow_comments').optional().isBoolean(),
  body('allow_favorites').optional().isBoolean(),
  body('allow_reactions').optional().isBoolean(),
  body('allow_color_labels').optional().isBoolean(),
  body('keybind_mode').optional().isIn(KEYBIND_MODES)
    .withMessage(`keybind_mode must be one of: ${KEYBIND_MODES.join(', ')}`),
  body('show_feedback_to_guests').optional().isBoolean(),
  // 'shared' (#1197) is a third identity model, not a third kind of person:
  // it drops the identity dimension from the COLOUR TAG only — one tag per
  // photo that any guest can overwrite — and leaves likes, ratings, comments,
  // favourites and reactions behaving exactly as in 'simple'.
  body('identity_mode').optional().isIn(['simple', 'guest', 'shared'])
    .withMessage('identity_mode must be "simple", "guest" or "shared"'),
  // Per-guest caps (#655). null / 0 = unlimited; positive integers enforced.
  // Upper bound is intentionally generous — operators occasionally run
  // "everyone, pick everything you like" galleries.
  body('max_favorites_per_guest')
    .optional({ nullable: true })
    .custom((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 10000))
    .withMessage('max_favorites_per_guest must be null or an integer between 0 and 10000'),
  body('max_likes_per_guest')
    .optional({ nullable: true })
    .custom((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 10000))
    .withMessage('max_likes_per_guest must be null or an integer between 0 and 10000'),
];


module.exports = {
  feedbackValidationRules,
  validateFeedbackType,
  validatePhotoId,
  validateEventId,
  validateFeedbackSubmission,
  validateFeedbackSettings,
  checkValidation,
  getValidationRules,
  sanitizeComment,
  validateGuestRequirements,
};
