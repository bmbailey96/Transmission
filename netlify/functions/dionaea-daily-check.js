const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');
const schedule = require('../../data/schedule.json');
const { sendEmail } = require('../../lib/sendEmail');
const { buildEmailHtml } = require('../../lib/buildEmailHtml');

const SENT_KEY = 'sent-item-ids';

/**
 * ACTIVATION_DATE is the one thing that has to be set before this goes
 * live — it's day-zero, the moment Mark's first email "arrives." Every
 * item's real send date is just ACTIVATION_DATE + item.dayOffset days.
 * Set as a Netlify environment variable, ISO date, e.g. "2026-08-01".
 */
function getActivationDate() {
  const raw = process.env.DIONAEA_ACTIVATION_DATE;
  if (!raw) {
    throw new Error(
      'DIONAEA_ACTIVATION_DATE is not set. Add it as an environment variable (e.g. "2026-08-01") — this is day zero for the whole schedule.'
    );
  }
  return new Date(raw + 'T00:00:00Z');
}

function readContent(item) {
  if (!item.contentFile) return null;
  const filePath = path.join(__dirname, '..', '..', item.contentFile);
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.trimStart().startsWith('PASTE_HERE')) return null; // not filled in yet
  return text;
}

exports.handler = async function (event) {
  connectLambda(event);

  const store = getStore('dionaea-house-history');
  let sentIds = [];
  try {
    const raw = await store.get(SENT_KEY, { type: 'json' });
    if (Array.isArray(raw)) sentIds = raw;
  } catch (err) {
    // no history yet — first run
  }
  const sentSet = new Set(sentIds);

  const activationDate = getActivationDate();
  const now = new Date();
  const daysSinceActivation = (now.getTime() - activationDate.getTime()) / (1000 * 60 * 60 * 24);

  // Every item whose scheduled offset has arrived and hasn't been sent yet.
  // Normally this is 0 or 1 item — but if a deploy was down for a day, or
  // this is the very first run after activation, it could legitimately be
  // more than one (e.g. the SMS burst arriving 15 minutes after the email
  // before it) — send all of them in order rather than just the first.
  const due = schedule
    .filter((item) => !sentSet.has(item.id) && item.dayOffset <= daysSinceActivation)
    .sort((a, b) => a.dayOffset - b.dayOffset);

  if (due.length === 0) {
    return { statusCode: 200, body: 'Nothing due today.' };
  }

  const results = [];

  for (const item of due) {
    if (item.absence) {
      // These are Brandon's own words from his casefile appendix, not
      // primary source text — safe to send directly.
      const html = buildEmailHtml({ item, content: null, absenceNote: item.note });
      await sendEmail({
        to: process.env.DIONAEA_TO_EMAIL || process.env.DIGEST_TO_EMAIL,
        subject: `Dionaea House — ${item.subject}`,
        html,
      });
      sentSet.add(item.id);
      results.push(`SENT (absence): ${item.id}`);
      continue;
    }

    const content = readContent(item);
    if (!content) {
      // Content not pasted in yet. Don't send a broken email — skip and
      // report it, and it'll be picked up the next time this runs once
      // the content file is filled in. Doesn't get marked as sent.
      results.push(`WAITING ON CONTENT: ${item.id} (${item.contentFile})`);
      continue;
    }

    const html = buildEmailHtml({ item, content, absenceNote: null });
    await sendEmail({
      to: process.env.DIONAEA_TO_EMAIL || process.env.DIGEST_TO_EMAIL,
      subject: `Dionaea House — ${item.subject}`,
      html,
    });
    sentSet.add(item.id);
    results.push(`SENT: ${item.id}`);
  }

  await store.set(SENT_KEY, JSON.stringify([...sentSet]));

  return { statusCode: 200, body: results.join('\n') };
};
