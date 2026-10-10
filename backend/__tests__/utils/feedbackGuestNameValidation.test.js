const { validateGuestRequirements } = require('../../src/utils/feedbackValidation');

describe('gallery guest identity validation without email', () => {
  it('allows guests to comment without collecting an email address', async () => {
    await expect(validateGuestRequirements({ require_name_email: false }, {}))
      .resolves.toEqual({ valid: true });
  });

  it('keeps the display-name requirement for older galleries that enabled it', async () => {
    await expect(validateGuestRequirements({ require_name_email: true }, {}))
      .resolves.toEqual({ valid: false, errors: ['Name is required'] });
    await expect(validateGuestRequirements({ require_name_email: true }, { guest_name: '小林' }))
      .resolves.toEqual({ valid: true });
  });
});
