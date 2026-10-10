const { db, logActivity } = require('../../database/db');
const { adminAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/permissions');
const { requireEventOwnership } = require('../../middleware/ownership');
const bcrypt = require('bcrypt');
const { galleryPasswordColumns, dropCopiesIfStorageOff } = require('../../utils/galleryPasswordVault');
const { credentialChangeColumns, sameAsStored } = require('../../utils/galleryCredentialCutoff');
const { validatePasswordInContext, getBcryptRounds } = require('../../utils/passwordValidation');
const { errorResponse } = require('../../utils/routeHelpers');

module.exports = (router) => {
  router.post('/:id/reset-password', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
    try {
      const { id } = req.params;
      let eventQuery = db('events').where('id', id);
      if (req.admin.roleName === 'editor') eventQuery = eventQuery.where('created_by', req.admin.id);
      const event = await eventQuery.first();
      if (!event) return res.status(404).json({ error: 'Event not found' });
      if (event.is_archived) return res.status(400).json({ error: 'Cannot reset password for archived event' });

      let newPassword = req.body?.password;
      if (typeof newPassword !== 'string' || !newPassword) {
        newPassword = require('../../utils/passwordGenerator').generateReadablePassword();
      }
      const validation = await validatePasswordInContext(newPassword, 'gallery', { eventName: event.event_name });
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Password does not meet security requirements',
          details: validation.errors,
          score: validation.score,
          feedback: validation.feedback,
        });
      }

      const copyColumns = await galleryPasswordColumns({ password: newPassword });
      const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());
      const keptHash = await sameAsStored(newPassword, event.password_hash)
        && await db('events').where({ id, password_hash: event.password_hash })
          .update(Object.keys(copyColumns).length ? copyColumns : { updated_at: new Date().toISOString() });
      if (!keptHash) {
        await db('events').where('id', id).update({
          password_hash: passwordHash,
          ...copyColumns,
          ...(await credentialChangeColumns('gallery')),
        });
      }
      await dropCopiesIfStorageOff(id);
      await logActivity('password_reset', { eventName: event.event_name }, id,
        { type: 'admin', id: req.admin.id, name: req.admin.username });

      res.json({ message: 'Password reset successfully', newPassword });
    } catch (error) {
      errorResponse(res, error, 500, 'Failed to reset password');
    }
  });
};
