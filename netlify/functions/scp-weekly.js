const { getStore, connectLambda } = require('@netlify/blobs');
const masterList = require('../../data/scp-master-list.json');
const sendOrder = require('../../data/scp-send-order.json');
const { fetchScpContent } = require('../../lib/fetchScpContent');
const { sendEmail } = require('../../lib/sendEmail');

const SENT_KEY = 'sent-urls';
const NEXT_SEND_KEY = 'next-send-at';

const { denverWallTimeToUTC } = require('../../lib/denverTime');

// Sporadic gap between sends: 1-8 days (average ~4.5), not tied to a
// fixed weekly schedule.
const MIN_GAP_DAYS = 1;
const MAX_GAP_DAYS = 8;

/**
 * Picks a random Montana-local send time: never between 11:00 PM and
 * 8:00 AM (no sends overnight), weighted toward evening (6 PM-11 PM)
 * the rest of the time, occasionally landing earlier in the day.
 * Converted to the correct UTC instant via the DST-aware helper, since
 * this schedule can run for years and will cross many DST transitions.
 */
function randomNextSendTime(from) {
  const gapDays = MIN_GAP_DAYS + Math.random() * (MAX_GAP_DAYS - MIN_GAP_DAYS);
  let target = new Date(from.getTime() + gapDays * 24 * 60 * 60 * 1000);

  // Allowed window: 8:00 AM - 11:00 PM Montana time (15 hours). Within
  // that, 70% chance of landing in the evening slice (6 PM-11 PM), 30%
  // chance anywhere in the daytime slice (8 AM-6 PM).
  let hour, minute;
  if (Math.random() < 0.7) {
    hour = 18 + Math.floor(Math.random() * 5); // 18-22 (6pm-10:59pm)
  } else {
    hour = 8 + Math.floor(Math.random() * 10); // 8-17 (8am-5:59pm)
  }
  minute = Math.floor(Math.random() * 60);

  const targetUTC = denverWallTimeToUTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    hour,
    minute
  );

  // If picking the hour pushed it before "from" (can happen when gapDays
  // rounds down near a day boundary), push forward one more day.
  if (targetUTC <= from) {
    const nextDay = new Date(targetUTC);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return denverWallTimeToUTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hour, minute);
  }
  return targetUTC;
}

const byUrl = Object.fromEntries(masterList.map((e) => [e.url, e]));

async function pickNextEntry(store) {
  let sent = [];
  try {
    const raw = await store.get(SENT_KEY, { type: 'json' });
    if (Array.isArray(raw)) sent = raw;
  } catch (err) {
    // no history yet -- first run
  }

  const sentSet = new Set(sent);
  let pool = sendOrder.filter((url) => !sentSet.has(url));

  // Once the whole order has been sent, start over rather than going
  // silent -- at roughly one every 7 days, this won't happen for over
  // 11 years.
  if (pool.length === 0) {
    sent = [];
    pool = sendOrder;
  }

  const chosenUrl = pool[0]; // first unsent entry in the fixed, pre-mixed order
  await store.set(SENT_KEY, JSON.stringify([...sent, chosenUrl]));
  return byUrl[chosenUrl];
}

function buildEmailHtml({ entry, content }) {
  return `
  <div style="background:#ffffff;padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td style="padding-bottom:8px;">
          <p style="margin:0;font-size:28px;font-weight:bold;color:#961e1e;font-family:Georgia,'Times New Roman',serif;">${entry.title}</p>
        </td>
      </tr>
      <tr>
        <td style="border-bottom:1px solid #999;padding-bottom:14px;"></td>
      </tr>
      <tr>
        <td style="padding-top:16px;font-size:14px;line-height:1.65;color:#000000;">
          ${content}
        </td>
      </tr>
      <tr>
        <td style="padding-top:20px;border-top:1px solid #ddd;margin-top:20px;">
          <p style="margin:16px 0 0;font-size:13px;">
            <a href="${entry.url}" style="color:#1155cc;">Read on the SCP Wiki &rarr;</a>
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

exports.handler = async function (event) {
  connectLambda(event);
  try {
    const store = getStore('scp-weekly-history');

    const now = new Date();
    let nextSendAt = null;
    try {
      const raw = await store.get(NEXT_SEND_KEY, { type: 'text' });
      if (raw) nextSendAt = new Date(raw);
    } catch (err) {
      // no schedule set yet -- first run, treat as due immediately
    }

    if (nextSendAt && now < nextSendAt) {
      return { statusCode: 200, body: `Not due yet. Next send: ${nextSendAt.toISOString()}` };
    }

    const entry = await pickNextEntry(store);
    const content = await fetchScpContent(entry.url);

    const html = buildEmailHtml({ entry, content });
    const subject = `Declassified: ${entry.title}`;

    await sendEmail({ to: process.env.SCP_TO_EMAIL || process.env.DIGEST_TO_EMAIL, subject, html });

    // Schedule the next one: 1-8 days out, at a genuinely random hour.
    const next = randomNextSendTime(now);
    await store.set(NEXT_SEND_KEY, next.toISOString());

    return { statusCode: 200, body: `Sent: ${entry.title} (${entry.url}). Next send scheduled for ${next.toISOString()}.` };
  } catch (err) {
    console.error('SCP digest failed:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
