const COLORS = {
  bg: '#0a0a0a',
  paper: '#f4f1ea', // aged-paper tone for "document" types
  text: '#1a1a1a',
  muted: '#6b6b6b',
  accent: '#7a1f1f', // dried-blood red, used sparingly
  hairline: '#d8d3c4',
};
const FONT_DOC = "Georgia, 'Times New Roman', serif"; // emails, blogs, lj — reads like a real found document
const FONT_UI = "-apple-system, Helvetica, Arial, sans-serif"; // wrapper chrome
const FONT_MONO = "'Courier New', ui-monospace, monospace"; // AIM log, SMS

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Converts plain pasted text into paragraphs. Assumes plain text input (not HTML) — one blank line = new paragraph. Bare imgur.com links become an actual inline <img>, hotlinked directly to imgur's own server (the image itself never passes through anything generated here) — with the original link kept underneath as a fallback, since some of these may be gallery pages rather than single direct images, and that can't be verified from this environment (imgur is unreachable from here to check). */
function extractImgurId(url) {
  // Some URLs have a descriptive slug before the real ID, e.g.
  // ".../best-guess-its-from-philippenes-FSKwqdI" — the actual ID is
  // always the final hyphen-separated segment.
  const afterDomain = url.split('imgur.com/')[1] || '';
  const segments = afterDomain.split('-');
  return segments[segments.length - 1].replace(/[^a-zA-Z0-9]/g, '');
}

function textToParagraphs(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, '<br/>');
      const withImages = escaped.replace(/(https?:\/\/(?:www\.)?imgur\.com\/\S+)/g, (url) => {
        const id = extractImgurId(url);
        const directUrl = `https://i.imgur.com/${id}.jpg`;
        return `
          <span style="display:block;margin:10px 0;">
            <img src="${directUrl}" alt="image" style="max-width:100%;height:auto;display:block;border:1px solid #999;" />
            <a href="${url}" style="display:inline-block;margin-top:4px;font-size:12px;color:#7a1f1f;text-decoration:none;">&#128247; view original on imgur &rarr;</a>
          </span>`;
      });
      return `<p style="margin:0 0 14px;">${withImages}</p>`;
    })
    .join('');
}

// Shown at the very top of every single email, same spot, every time —
// answers "what kind of thing is this" before you even read the sender.
const TYPE_LABELS = {
  'email': 'EMAIL',
  'sms-single': 'TEXT MESSAGE',
  'sms-burst': 'TEXT MESSAGES',
  'comment': 'BLOG COMMENT',
  'lj': 'LIVEJOURNAL ENTRY',
  'blog': 'BLOG POST',
  'aimlog': 'RECOVERED CHAT LOG',
  'bounce': 'UNDELIVERABLE MAIL NOTICE',
  'update-log': 'SITE UPDATE',
  'site-frontpage': 'WEBSITE',
  'epilogue-original': 'FORUM POST',
};

function wrapShell({ innerHtml, item }) {
  const typeLabel = TYPE_LABELS[item.type] || '';
  const senderLine = item.sender ? escapeHtml(item.sender) : '';
  return `
  <div style="background:${COLORS.bg};padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:${FONT_UI};">
      <tr>
        <td style="padding-bottom:6px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#222;border:1px solid #444;border-radius:3px;padding:3px 8px;">
                <span style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.08em;color:#9dd6c4;">${typeLabel}</span>
              </td>
              ${senderLine ? `<td style="padding-left:8px;"><span style="font-family:${FONT_UI};font-size:12px;color:#999;">${senderLine}</span></td>` : ''}
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:16px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.12em;color:#666;text-transform:uppercase;">Dionaea House &mdash; Part ${item.partTitle ? '' : ''}${item.partTitle || ''}</p>
        </td>
      </tr>
      <tr><td>${innerHtml}</td></tr>
      <tr>
        <td style="padding-top:18px;">
          <p style="margin:0;font-size:11px;color:#555;">${new Date(item.realDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildDocumentCard({ headerHtml, bodyHtml }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper};border:1px solid ${COLORS.hairline};">
      <tr>
        <td style="padding:20px 24px;">
          ${headerHtml}
          <div style="font-family:${FONT_DOC};font-size:15px;line-height:1.6;color:${COLORS.text};">
            ${bodyHtml}
          </div>
        </td>
      </tr>
    </table>`;
}

function buildEmailHtml({ item, content, absenceNote }) {
  let inner;

  if (absenceNote) {
    // The most important visual moment in the whole project — this should
    // feel like almost nothing, on purpose. Mostly empty space.
    inner = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:60px 20px;text-align:center;">
            <p style="font-family:${FONT_MONO};font-size:13px;color:#444;letter-spacing:0.05em;margin:0 0 20px;">— nothing arrived today —</p>
            <p style="font-family:${FONT_DOC};font-size:14px;line-height:1.7;color:#999;font-style:italic;max-width:420px;margin:0 auto;">${escapeHtml(absenceNote)}</p>
          </td>
        </tr>
      </table>`;
    return wrapShell({ innerHtml: inner, item });
  }

  const bodyHtml = textToParagraphs(content);

  switch (item.type) {
    case 'email': {
      const header = `<div style="border-bottom:1px solid ${COLORS.hairline};padding-bottom:10px;margin-bottom:16px;font-family:${FONT_MONO};font-size:12px;color:${COLORS.muted};">
        <div>from: ${escapeHtml(item.sender)}</div>
        <div>subject: ${escapeHtml(item.subject)}</div>
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'sms-single':
    case 'sms-burst': {
      inner = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};">
          <tr><td style="padding:16px 6px;font-family:${FONT_MONO};font-size:13px;color:#8fd18f;line-height:2;">
            ${bodyHtml.replace(/<p /g, '<p style="background:#111;border-radius:6px;padding:8px 12px;display:inline-block;margin:0 0 8px;" ')}
          </td></tr>
        </table>`;
      break;
    }
    case 'comment': {
      const header = `<div style="margin-bottom:14px;border-bottom:1px dashed ${COLORS.accent};padding-bottom:8px;">
        <p style="font-family:${FONT_MONO};font-size:11px;color:${COLORS.accent};margin:0;">COMMENT &mdash; ${escapeHtml(item.subject)}</p>
        <p style="font-family:${FONT_UI};font-size:11px;color:${COLORS.muted};margin:2px 0 0;">posted as: ${escapeHtml(item.sender)}</p>
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'lj': {
      const header = `<div style="margin-bottom:14px;">
        <p style="font-family:${FONT_UI};font-size:12px;color:${COLORS.accent};margin:0;">${escapeHtml(item.sender)}</p>
        <p style="font-family:${FONT_DOC};font-size:18px;font-weight:bold;margin:2px 0 0;">${escapeHtml(item.subject)}</p>
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'blog': {
      const header = `<div style="margin-bottom:14px;">
        <p style="font-family:${FONT_UI};font-size:11px;color:${COLORS.muted};margin:0;">dionaeahouse.blogspot.com</p>
        <p style="font-family:${FONT_DOC};font-size:18px;font-weight:bold;margin:2px 0 0;">${escapeHtml(item.subject)}</p>
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'aimlog': {
      inner = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;border:1px solid #333;">
          <tr><td style="padding:18px 20px;">
            <p style="font-family:${FONT_UI};font-size:12px;color:#888;margin:0 0 14px;border-bottom:1px solid #333;padding-bottom:10px;">
              Recovered from Diane M.'s father's PC. Converted to HTML by Eric Heisserer, screen name numbers removed. Original session: February 10, 1999.
            </p>
            <div style="font-family:${FONT_MONO};font-size:13px;color:#c0c0c0;line-height:1.8;">
              ${bodyHtml}
            </div>
          </td></tr>
        </table>`;
      break;
    }
    case 'bounce': {
      const header = `<div style="border-bottom:1px solid ${COLORS.hairline};padding-bottom:10px;margin-bottom:16px;font-family:${FONT_MONO};font-size:12px;color:${COLORS.accent};">
        MAILER-DAEMON: ${escapeHtml(item.subject)}
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'update-log': {
      const header = `<div style="margin-bottom:14px;"><p style="font-family:${FONT_MONO};font-size:12px;color:${COLORS.muted};margin:0;">dionaea-house.com/updates.htm</p></div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
    case 'site-frontpage':
    default: {
      const header = `<div style="margin-bottom:14px;"><p style="font-family:${FONT_MONO};font-size:12px;color:${COLORS.muted};margin:0;">dionaea-house.com</p></div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml });
      break;
    }
  }

  return wrapShell({ innerHtml: inner, item });
}

module.exports = { buildEmailHtml };
