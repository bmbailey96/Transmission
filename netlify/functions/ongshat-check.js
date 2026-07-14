const { getStore, connectLambda } = require('@netlify/blobs');
const sequence = require('../../data/ongshat-sequence.json');
const { sendEmail } = require('../../lib/sendEmail');
const { buildOngshatEmailHtml, buildSubject } = require('../../lib/buildOngshatEmailHtml');
const { denverWallTimeToUTC } = require('../../lib/denverTime');

const CURSOR_KEY = 'next-index';
const NEXT_SEND_KEY = 'next-send-at';

// 122 items (89 source + 14 note + 19 image) at this gap averages out to
// roughly six months end to end. Tune these two numbers to speed up or
// slow down the whole run; nothing else needs to change.
const MIN_GAP_DAYS = 0.75;
const MAX_GAP_DAYS = 2.25;

/**
 * Picks a random Montana-local send time, weighted toward evening,
 * never overnight (11pm-8am) -- same shape as the SCP digest's timing,
 * so an unexplained fragment never arrives at 3am and gives itself away
 * as an automated thing.
 */
function randomNextSendTime(from) {
  const gapDays = MIN_GAP_DAYS + Math.random() * (MAX_GAP_DAYS - MIN_GAP_DAYS);
  const target = new Date(from.getTime() + gapDays * 24 * 60 * 60 * 1000);

  let hour;
  if (Math.random() < 0.7) {
    hour = 18 + Math.floor(Math.random() * 5); // 6pm-10:59pm
  } else {
    hour = 8 + Math.floor(Math.random() * 10); // 8am-5:59pm
  }
  const minute = Math.floor(Math.random() * 60);

  const targetUTC = denverWallTimeToUTC(
    target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), hour, minute
  );
  if (targetUTC <= from) {
    const nextDay = new Date(targetUTC);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return denverWallTimeToUTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hour, minute);
  }
  return targetUTC;
}

exports.handler = async function (event) {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || '';

  // ?test_index=N sends that item right now regardless of schedule, and
  // never touches the stored cursor -- safe to use repeatedly while
  // checking how things render.
  if (params.test_index !== undefined) {
    const idx = parseInt(params.test_index, 10);
    const item = sequence[idx];
    if (!item) return { statusCode: 404, body: `No item at index ${idx}. Sequence has ${sequence.length} items (0-${sequence.length - 1}).` };
    const html = buildOngshatEmailHtml({ item, siteUrl });
    await sendEmail({
      to: process.env.ONGSHAT_TO_EMAIL || process.env.DIGEST_TO_EMAIL,
      subject: `${buildSubject(item)} [TEST]`,
      html,
    });
    return { statusCode: 200, body: `SENT [TEST]: index ${idx}, type ${item.type}` };
  }

  try {
    const store = getStore('ongshat-drip-history');

    let cursor = 0;
    try {
      const raw = await store.get(CURSOR_KEY, { type: 'text' });
      if (raw !== null) cursor = parseInt(raw, 10);
    } catch (err) {
      // first run
    }

    if (cursor >= sequence.length) {
      return { statusCode: 200, body: 'Sequence finished. Nothing left to send.' };
    }

    const now = new Date();
    let nextSendAt = null;
    try {
      const raw = await store.get(NEXT_SEND_KEY, { type: 'text' });
      if (raw) nextSendAt = new Date(raw);
    } catch (err) {
      // no schedule set yet -- treat as due immediately
    }

    if (nextSendAt && now < nextSendAt) {
      return { statusCode: 200, body: `Not due yet. Next send: ${nextSendAt.toISOString()}` };
    }

    const item = sequence[cursor];
    const html = buildOngshatEmailHtml({ item, siteUrl });
    const subject = buildSubject(item);

    await sendEmail({ to: process.env.ONGSHAT_TO_EMAIL || process.env.DIGEST_TO_EMAIL, subject, html });

    const next = randomNextSendTime(now);
    await store.set(CURSOR_KEY, String(cursor + 1));
    await store.set(NEXT_SEND_KEY, next.toISOString());

    return {
      statusCode: 200,
      body: `Sent: index ${cursor} (${item.type}). Next send scheduled for ${next.toISOString()}.`,
    };
  } catch (err) {
    console.error('Ong\'s Hat drip failed:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
