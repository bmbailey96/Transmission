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

/**
 * Parses raw SMS content (one or more messages, each with its own
 * "from:/date:/subject:" header block from how these were originally
 * captured as emails) into {timestamp, body} pairs, discarding the
 * header noise so only the timestamp and actual text survive.
 */
function parseSmsMessages(text) {
  const blocks = text.trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const dateMatch = block.match(/date:\s*\w+,\s*(\w+\s+\d{1,2},\s*\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      // The header wraps across two physical lines ("from: ... | date:
      // Tuesday," then "September 21, 2004 4:14 PM | subject: ..."). A
      // per-line filter missed the continuation line since it doesn't
      // itself start with "date:" or "subject:" — strip the whole
      // from:...subject:... span as one unit instead, whatever it spans.
      const body = block.replace(/from:[\s\S]*?subject:[^\n]*\n?/i, '').trim();
      return {
        timestamp: dateMatch ? dateMatch[1] : null,
        body: body.replace(/\n/g, ' ').trim(),
      };
    })
    .filter((m) => m.body);
}

function renderSmsBubbles(messages) {
  return messages
    .map(
      (m) => `
      <div style="margin:0 0 14px;text-align:right;">
        ${m.timestamp ? `<p style="margin:0 0 3px;font-family:${FONT_UI};font-size:10px;color:#666;">${escapeHtml(m.timestamp)}</p>` : ''}
        <div style="display:inline-block;max-width:80%;background:#0b5c3f;color:#e8fff3;border-radius:14px 14px 2px 14px;padding:8px 14px;font-family:${FONT_UI};font-size:14px;line-height:1.4;text-align:left;">
          ${escapeHtml(m.body)}
        </div>
      </div>`
    )
    .join('');
}

/**
 * Parses an AIM chat log into its header/intro lines plus a sequence of
 * {speaker, line} messages, assigning each distinct speaker a consistent
 * color (cycling through a small palette) the way real AIM clients
 * color-coded each buddy in a conversation.
 */
const AIM_PALETTE = ['#7fb8ff', '#ff8fc7', '#ffd27f', '#8fffb0'];

function parseAimLog(text) {
  const lines = text.split('\n');
  const introLines = [];
  const messages = [];
  let pastIntro = false;

  for (const line of lines) {
    const msgMatch = line.match(/^(\w+):\s?(.*)$/);
    if (msgMatch && !/^Session Start/i.test(line)) {
      pastIntro = true;
      messages.push({ speaker: msgMatch[1], line: msgMatch[2] });
    } else if (!pastIntro) {
      if (line.trim()) introLines.push(line.trim());
    }
  }

  const speakerColors = {};
  let colorIdx = 0;
  for (const m of messages) {
    if (!(m.speaker in speakerColors)) {
      speakerColors[m.speaker] = AIM_PALETTE[colorIdx % AIM_PALETTE.length];
      colorIdx++;
    }
  }

  return { introLines, messages, speakerColors };
}

function renderAimLog({ introLines, messages, speakerColors }) {
  const introHtml = introLines
    .map((l) => `<p style="font-family:${FONT_MONO};font-size:12px;color:#888;margin:0 0 4px;">${escapeHtml(l)}</p>`)
    .join('');
  const messagesHtml = messages
    .map(
      (m) => `
      <p style="margin:0 0 6px;font-family:${FONT_MONO};font-size:13px;line-height:1.6;">
        <span style="color:${speakerColors[m.speaker]};font-weight:bold;">${escapeHtml(m.speaker)}:</span>
        <span style="color:#c0c0c0;">${escapeHtml(m.line)}</span>
      </p>`
    )
    .join('');
  return `<div style="margin-bottom:12px;">${introHtml}</div>${messagesHtml}`;
}

/** Pulls "current mood:"/"current music:" lines out of the end of an LJ entry so they can get their own small footer treatment instead of blending into body paragraphs. */
function extractLjFooter(text) {
  const moodMatch = text.match(/current mood:\s*(.+)/i);
  const musicMatch = text.match(/current music:\s*(.+)/i);
  const withoutFooter = text.replace(/current mood:.*/i, '').replace(/current music:.*/i, '').trim();
  return {
    body: withoutFooter,
    mood: moodMatch ? moodMatch[1].trim() : null,
    music: musicMatch ? musicMatch[1].trim() : null,
  };
}

/** Parses the r/subreddit, date, and username: lines already present at the top of the 2014 post content, separating them from the actual post body. */
function parseRedditPost(text) {
  const lines = text.split('\n');
  let subreddit = null;
  let username = null;
  let lastHeaderLineIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const l = lines[i].trim();
    if (/^r\//.test(l)) {
      subreddit = l;
      lastHeaderLineIdx = i;
    }
    const uMatch = l.match(/^username:\s*(.+)/i);
    if (uMatch) {
      username = uMatch[1].trim();
      lastHeaderLineIdx = i;
    }
    // A plain date line ("October 2014") between the header fields doesn't
    // match either pattern but still needs to count as part of the header,
    // not the start of the body — only stop extending once neither pattern
    // matches AND we've already found at least one header field, and this
    // line looks like body text rather than another header line.
    if (lastHeaderLineIdx === i - 1 && !/^r\//.test(l) && !uMatch && lastHeaderLineIdx !== -1 && /^\w+\s+\d{4}$/.test(l)) {
      lastHeaderLineIdx = i; // e.g. "October 2014"
    }
  }
  const bodyStartIdx = lastHeaderLineIdx + 1;
  const body = lines.slice(bodyStartIdx).join('\n').trim();
  return { subreddit, username, body };
}

function renderRedditPost({ subreddit, username, body, subject }) {
  const bodyHtml = textToParagraphs(body);
  const metaLine =
    subreddit || username
      ? `<p style="margin:0 0 6px;font-family:${FONT_UI};font-size:12px;color:#787c7e;">
          ${subreddit ? `<strong style="color:#1a1a1b;">${escapeHtml(subreddit)}</strong>${username ? ' &middot; ' : ''}` : ''}${username ? `Posted by u/${escapeHtml(username)}` : ''}
        </p>`
      : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ccc;border-radius:4px;">
      <tr>
        <td style="width:36px;background:#f8f9fa;border-right:1px solid #eee;vertical-align:top;padding:14px 0 0;text-align:center;">
          <div style="width:0;height:0;margin:0 auto;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:14px solid #ff4500;"></div>
        </td>
        <td style="padding:14px 18px;">
          ${metaLine}
          <p style="margin:0 0 12px;font-family:${FONT_UI};font-size:19px;font-weight:600;color:#222;line-height:1.3;">${escapeHtml(subject)}</p>
          <div style="font-family:${FONT_UI};font-size:14px;line-height:1.6;color:#1a1a1b;">
            ${bodyHtml}
          </div>
        </td>
      </tr>
    </table>`;
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
      const messages = parseSmsMessages(content);
      inner = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};">
          <tr><td style="padding:16px 10px;">
            ${renderSmsBubbles(messages)}
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
      const { body: ljBody, mood, music } = extractLjFooter(content);
      const ljBodyHtml = textToParagraphs(ljBody);
      const footer =
        mood || music
          ? `<div style="margin-top:14px;padding-top:10px;border-top:1px solid ${COLORS.hairline};">
              ${mood ? `<p style="margin:0;font-family:${FONT_UI};font-size:12px;font-style:italic;color:${COLORS.muted};">current mood: ${escapeHtml(mood)}</p>` : ''}
              ${music ? `<p style="margin:2px 0 0;font-family:${FONT_UI};font-size:12px;font-style:italic;color:${COLORS.muted};">current music: ${escapeHtml(music)}</p>` : ''}
            </div>`
          : '';
      const header = `<div style="margin-bottom:14px;">
        <p style="font-family:${FONT_UI};font-size:12px;color:${COLORS.accent};margin:0;">${escapeHtml(item.sender)}</p>
        <p style="font-family:${FONT_DOC};font-size:18px;font-weight:bold;margin:2px 0 0;">${escapeHtml(item.subject)}</p>
      </div>`;
      inner = buildDocumentCard({ headerHtml: header, bodyHtml: ljBodyHtml + footer });
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
      const parsed = parseAimLog(content);
      inner = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;border:1px solid #333;">
          <tr><td style="padding:18px 20px;">
            <p style="font-family:${FONT_UI};font-size:12px;color:#888;margin:0 0 14px;border-bottom:1px solid #333;padding-bottom:10px;">
              Recovered from Diane M.'s father's PC. Converted to HTML by Eric Heisserer, screen name numbers removed. Original session: February 10, 1999.
            </p>
            ${renderAimLog(parsed)}
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
    case 'epilogue-original': {
      const parsed = parseRedditPost(content);
      inner = renderRedditPost({ ...parsed, subject: item.subject });
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
