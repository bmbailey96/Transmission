const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');
const schedule = require('../../data/schedule.json');
const { sendEmail } = require('../../lib/sendEmail');
const { buildEmailHtml } = require('../../lib/buildEmailHtml');
const { denverWallTimeToUTC } = require('../../lib/denverTime');

const SENT_KEY = 'sent-item-ids';

/**
 * ACTIVATION_DATE is day zero -- the calendar date Mark's first email
 * "arrives." Every item's real send moment is ACTIVATION_DATE + item's
 * compressed dayIndex, at item.hour:item.minute Mountain Time (the
 * ORIGINAL, uncompressed clock time from the real historical record).
 * Set as a Netlify environment variable, ISO date, e.g. "2026-08-01".
 */
function getActivationDateParts() {
  const raw = process.env.DIONAEA_ACTIVATION_DATE;
  if (!raw) {
    throw new Error(
      'DIONAEA_ACTIVATION_DATE is not set. Add it as an environment variable (e.g. "2026-08-01") -- this is day zero for the whole schedule.'
    );
  }
  const [year, month, day] = raw.split('-').map((n) => parseInt(n, 10));
  return { year, month, day };
}

function targetInstantFor(item, activationParts) {
  const base = new Date(Date.UTC(activationParts.year, activationParts.month - 1, activationParts.day));
  base.setUTCDate(base.getUTCDate() + item.dayIndex);
  return denverWallTimeToUTC(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    item.hour,
    item.minute
  );
}

function readContent(item) {
  if (!item.contentFile) return null;
  const filePath = path.join(__dirname, '..', '..', item.contentFile);
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.trimStart().startsWith('PASTE_HERE')) return null;
  return text;
}

/** Builds and sends the email for a single item. Returns a short status string. Does NOT touch the sent-tracking store -- callers decide whether this counts as "really sent." */
async function sendOne(item, { testMode }) {
  if (item.absence) {
    const html = buildEmailHtml({ item, content: null, absenceNote: item.note });
    await sendEmail({
      to: process.env.DIONAEA_TO_EMAIL || process.env.DIGEST_TO_EMAIL,
      subject: `Dionaea House -- ${item.subject}${testMode ? ' [TEST]' : ''}`,
      html,
    });
    return { ok: true, message: `SENT (absence)${testMode ? ' [TEST]' : ''}: ${item.id}` };
  }

  const content = readContent(item);
  if (!content) {
    return { ok: false, message: `WAITING ON CONTENT: ${item.id} (${item.contentFile})` };
  }

  const html = buildEmailHtml({ item, content, absenceNote: null });
  await sendEmail({
    to: process.env.DIONAEA_TO_EMAIL || process.env.DIGEST_TO_EMAIL,
    subject: `Dionaea House -- ${item.subject}${testMode ? ' [TEST]' : ''}`,
    html,
  });
  return { ok: true, message: `SENT${testMode ? ' [TEST]' : ''}: ${item.id}` };
}

exports.handler = async function (event) {
  connectLambda(event);

  const params = event.queryStringParameters || {};

  // --- TEST MODE: ?test_id=<schedule id> sends that one item right now,
  // regardless of whether it's actually due yet, and never touches the
  // real sent-tracking store -- so testing never disturbs the real
  // schedule playing out. ?list=1 instead just lists every valid id.
  if (params.list) {
    const ids = schedule.map((i) => `${i.id}  (${i.type}, day ${i.dayIndex})`);
    return { statusCode: 200, body: ids.join('\n') };
  }

  if (params.test_id) {
    const item = schedule.find((i) => i.id === params.test_id);
    if (!item) {
      return { statusCode: 404, body: `No item with id "${params.test_id}". Add ?list=1 to see all valid ids.` };
    }
    const result = await sendOne(item, { testMode: true });
    return { statusCode: result.ok ? 200 : 200, body: result.message };
  }

  // --- NORMAL MODE: real scheduled check ---
  const store = getStore('dionaea-house-history');
  let sentIds = [];
  try {
    const raw = await store.get(SENT_KEY, { type: 'json' });
    if (Array.isArray(raw)) sentIds = raw;
  } catch (err) {
    // no history yet -- first run
  }
  const sentSet = new Set(sentIds);

  const activationParts = getActivationDateParts();
  const now = new Date();

  const due = schedule
    .filter((item) => !sentSet.has(item.id) && targetInstantFor(item, activationParts) <= now)
    .sort((a, b) => targetInstantFor(a, activationParts) - targetInstantFor(b, activationParts));

  if (due.length === 0) {
    return { statusCode: 200, body: 'Nothing due right now.' };
  }

  const results = [];
  for (const item of due) {
    const result = await sendOne(item, { testMode: false });
    if (result.ok) sentSet.add(item.id);
    results.push(result.message);
  }

  await store.set(SENT_KEY, JSON.stringify([...sentSet]));
  return { statusCode: 200, body: results.join('\n') };
};
