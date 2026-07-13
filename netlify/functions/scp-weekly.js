const { getStore } = require('@netlify/blobs');
const masterList = require('../../data/scp-master-list.json');
const { fetchScpContent } = require('../../lib/fetchScpContent');
const { sendEmail } = require('../../lib/sendEmail'); // copy this in from your Transmission repo — same Resend wrapper, no changes needed.

const SENT_KEY = 'sent-urls';

async function pickNextEntry(store) {
  let sent = [];
  try {
    const raw = await store.get(SENT_KEY, { type: 'json' });
    if (Array.isArray(raw)) sent = raw;
  } catch (err) {
    // no history yet — first run
  }

  const sentSet = new Set(sent);
  let pool = masterList.filter((e) => !sentSet.has(e.url));

  // Once every entry in the pool has been sent, start over rather than
  // stopping — a 596-entry pool means this won't happen for over 11 years
  // at one a week, but the reset is here so it never just goes silent.
  if (pool.length === 0) {
    sent = [];
    pool = masterList;
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  await store.set(SENT_KEY, JSON.stringify([...sent, chosen.url]));
  return chosen;
}

// Matches the actual SCP Wiki's own look: white background, black body
// text, the wiki's red/maroon heading color, a thin divider under the
// title — rather than reskinning it into anything of our own invention.
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

exports.handler = async function () {
  try {
    const store = getStore('scp-weekly-history');
    const entry = await pickNextEntry(store);
    const content = await fetchScpContent(entry.url);

    const html = buildEmailHtml({ entry, content });
    const subject = `Declassified: ${entry.title}`;

    await sendEmail({ to: process.env.SCP_TO_EMAIL || process.env.DIGEST_TO_EMAIL, subject, html });

    return { statusCode: 200, body: `Sent: ${entry.title} (${entry.url})` };
  } catch (err) {
    console.error('SCP weekly digest failed:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
