/**
 * Pre-event customer reminder templates — definitions + runtime self-heal.
 *
 * Migration 143 originally seeded an empty `event_reminder_default` row.
 * That left admins staring at a blank editor. We self-heal at
 * runtime instead of bolting on a follow-up migration.
 *
 * `ensureEventReminderTemplatesSeeded(db, logger)` is idempotent — call
 * it as often as you like:
 *   - A missing template key is inserted with EN+DE example content.
 *   - An existing template whose EN translation is entirely empty
 *     (the legacy migration-143 case) are backfilled with the example
 *     content. Translations that already have any subject/body content
 *     are LEFT ALONE so an admin's customisations never get clobbered.
 *
 * Process-level boolean caches the "all templates verified" state once
 * we've made one successful pass, so the cron's hourly retick is free.
 *
 * Variables expected on every template: customer_name, event_name,
 * event_date, days_before, business_name. Keep this list in
 * sync with eventReminderService.composePayload.
 *
 */

const VARIABLES = [
  'customer_name', 'event_name', 'event_date',
  'days_before', 'business_name',
];

// Tiny HTML signature line shared across templates so the maintainer
// only has to brand once. Variables substitute at render time.
const SIGNATURE_EN = '<p style="margin-top: 24px;">See you soon,<br>{{business_name}}</p>';
const SIGNATURE_DE = '<p style="margin-top: 24px;">Bis bald,<br>{{business_name}}</p>';

const EVENT_REMINDER_TEMPLATES = {
  event_reminder_default: {
    en: {
      subject: 'Reminder: {{event_name}} in {{days_before}} day(s)',
      body_html: `<p>Hi {{customer_name}},</p>
<p>Just a quick reminder that <strong>{{event_name}}</strong> is coming up on <strong>{{event_date}}</strong> — about {{days_before}} day(s) from now.</p>
<p>A few things that help us hit the ground running on the day:</p>
<ul>
  <li>Confirm the exact start time and address (a what3words pin works great).</li>
  <li>Let us know if there is anything we should keep an eye on — VIPs, surprise moments, restricted areas.</li>
  <li>Indoor venues: a small corner for equipment setup is a huge help.</li>
</ul>
<p>If anything has changed since we last spoke, just hit reply.</p>
${SIGNATURE_EN}`,
      body_text: 'Hi {{customer_name}},\n\nJust a quick reminder that {{event_name}} is coming up on {{event_date}} — about {{days_before}} day(s) from now.\n\nA few things that help us hit the ground running on the day:\n- Confirm the exact start time and address.\n- Let us know if there is anything we should keep an eye on (VIPs, surprise moments, restricted areas).\n- Indoor venues: a small corner for equipment setup is a huge help.\n\nIf anything has changed since we last spoke, just hit reply.\n\nSee you soon,\n{{business_name}}',
    },
    de: {
      subject: 'Erinnerung: {{event_name}} in {{days_before}} Tag(en)',
      body_html: `<p>Hallo {{customer_name}},</p>
<p>kurze Erinnerung: <strong>{{event_name}}</strong> findet am <strong>{{event_date}}</strong> statt — in etwa {{days_before}} Tag(en).</p>
<p>Damit wir am Tag selbst sofort loslegen können, helfen uns folgende Punkte sehr:</p>
<ul>
  <li>Genaue Startzeit und Adresse bestätigen (gerne auch ein what3words-Pin).</li>
  <li>Kurz Bescheid geben, falls etwas besonders zu beachten ist — VIPs, Überraschungsmomente, abgesperrte Bereiche.</li>
  <li>Bei Innen-Locations: eine kleine Ecke für den Equipment-Aufbau ist Gold wert.</li>
</ul>
<p>Hat sich seit unserem letzten Austausch etwas geändert? Einfach kurz auf diese Mail antworten.</p>
${SIGNATURE_DE}`,
      body_text: 'Hallo {{customer_name}},\n\nkurze Erinnerung: {{event_name}} findet am {{event_date}} statt — in etwa {{days_before}} Tag(en).\n\nDamit wir am Tag selbst sofort loslegen können, helfen uns folgende Punkte sehr:\n- Genaue Startzeit und Adresse bestätigen.\n- Kurz Bescheid geben, falls etwas besonders zu beachten ist (VIPs, Überraschungsmomente, abgesperrte Bereiche).\n- Bei Innen-Locations: eine kleine Ecke für den Equipment-Aufbau ist Gold wert.\n\nHat sich seit unserem letzten Austausch etwas geändert? Einfach kurz auf diese Mail antworten.\n\nBis bald,\n{{business_name}}',
    },
  },
};

let _seeded = false;

/**
 * Idempotent seed/backfill for the shared project reminder template.
 * Safe to call repeatedly — both at boot and inside the cron tick.
 *
 * Rules:
 *   - Missing template_key → insert master row + translations.
 *   - Existing template_key whose EN translation is entirely empty
 *     (subject + body_html + body_text all blank) → backfill EN+DE.
 *     This matches the legacy migration-143 "empty seed" case without
 *     ever touching admin-customised content.
 *   - Existing template_key with non-empty EN translation → leave alone.
 *
 * Returns array of template_keys touched (inserted or backfilled) for
 * diagnostic logging.
 */
async function ensureEventReminderTemplatesSeeded(db, logger) {
  if (_seeded) return [];
  if (!(await db.schema.hasTable('email_templates'))) return [];

  const cols = await db('email_templates').columnInfo();
  const hasTranslationsTable = await db.schema.hasTable('email_template_translations');
  const touched = [];

  const isEmpty = (tr) => {
    if (!tr) return true;
    const s = (tr.subject || '').trim();
    const h = (tr.body_html || '').trim();
    const t = (tr.body_text || '').trim();
    return !s && !h && !t;
  };

  const upsertTranslation = async (templateId, language, content) => {
    if (!hasTranslationsTable) return;
    const existing = await db('email_template_translations')
      .where({ template_id: templateId, language })
      .first();
    if (existing && !isEmpty(existing)) return; // never overwrite admin edits
    if (existing) {
      await db('email_template_translations')
        .where({ id: existing.id })
        .update({
          subject: content.subject,
          body_html: content.body_html,
          body_text: content.body_text,
          updated_at: new Date(),
        });
    } else {
      await db('email_template_translations').insert({
        template_id: templateId,
        language,
        subject: content.subject,
        body_html: content.body_html,
        body_text: content.body_text,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  };

  for (const [templateKey, def] of Object.entries(EVENT_REMINDER_TEMPLATES)) {
    try {
      let existing = await db('email_templates').where({ template_key: templateKey }).first();

      if (!existing) {
        const en = def.en;
        const masterRow = {
          template_key: templateKey,
          variables: JSON.stringify(VARIABLES),
        };
        if ('category' in cols)     masterRow.category = 'customers';
        if ('subcategory' in cols)  masterRow.subcategory = 'event_reminder';
        if ('feature_flag' in cols) masterRow.feature_flag = 'reminderEmails';
        if ('created_at' in cols)   masterRow.created_at = new Date();
        if ('updated_at' in cols)   masterRow.updated_at = new Date();
        // Fill legacy subject_<lang>/body_html_<lang> columns if present.
        for (const colName of Object.keys(cols)) {
          if (colName === 'subject' || /^subject_[a-z]{2,3}$/i.test(colName)) {
            masterRow[colName] = en.subject;
          } else if (colName === 'body_html' || /^body_html_[a-z]{2,3}$/i.test(colName)) {
            masterRow[colName] = en.body_html;
          } else if (colName === 'body_text' || /^body_text_[a-z]{2,3}$/i.test(colName)) {
            masterRow[colName] = en.body_text;
          }
        }
        const inserted = await db('email_templates').insert(masterRow).returning('id');
        const templateId = typeof inserted[0] === 'object' ? inserted[0].id : inserted[0];
        await upsertTranslation(templateId, 'en', def.en);
        await upsertTranslation(templateId, 'de', def.de);
        touched.push(templateKey);
        if (logger) logger.info(`Self-healed event reminder template: ${templateKey}`);
        continue;
      }

      // Template exists — backfill empty translations only.
      if (hasTranslationsTable) {
        const en = await db('email_template_translations')
          .where({ template_id: existing.id, language: 'en' })
          .first();
        if (isEmpty(en)) {
          await upsertTranslation(existing.id, 'en', def.en);
          await upsertTranslation(existing.id, 'de', def.de);
          touched.push(templateKey);
          if (logger) logger.info(`Self-healed empty event reminder translations: ${templateKey}`);
        }
      }
    } catch (err) {
      if (logger) {
        logger.error(`Failed to seed event reminder template ${templateKey}`, {
          message: err.message,
        });
      }
      // Keep _seeded=false so the next pass retries.
      return touched;
    }
  }

  _seeded = true;
  return touched;
}

module.exports = {
  EVENT_REMINDER_TEMPLATES,
  ensureEventReminderTemplatesSeeded,
};
