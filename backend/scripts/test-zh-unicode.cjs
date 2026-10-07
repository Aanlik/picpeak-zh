const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const { validateFeedbackSubmission } = require('../src/utils/feedbackValidation');

async function validate(name) {
  const req = { body: { feedback_type: 'comment', comment_text: '精修建议', guest_name: name } };
  for (const rule of validateFeedbackSubmission) await rule.run(req);
  return validationResult(req).array();
}
for (const name of ['张小明', '阿依古丽·买买提', 'José García', 'Zoë', "O'Connor", '客户 01']) {
  test(`accepts Unicode client name: ${name}`, async () => assert.deepEqual(await validate(name), []));
}
for (const name of ['<script>', 'A\u0000B', 'A\nB', '😀', 'A'.repeat(101)]) {
  test(`rejects unsafe or overlong name: ${JSON.stringify(name)}`, async () => {
    assert.ok((await validate(name)).some(e => e.path === 'guest_name'));
  });
}
