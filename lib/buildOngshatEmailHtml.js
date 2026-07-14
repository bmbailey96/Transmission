/**
 * Renders one Ong's Hat sequence item as an email body. Deliberately
 * plainer than the Dionaea House renderer -- no period-software chrome,
 * because this isn't imitating specific software, it's imitating a
 * photocopied document landing in your inbox with nothing around it.
 *
 * Three types:
 *   source -- real 2002 Matheny excerpt. Numbered subject, CC footer.
 *   note   -- original investigator-note fragment. Bare "." subject, no footer.
 *   image  -- a scanned catalog/brochure page. Bare "." subject, no footer,
 *             no body text at all, just the image.
 */

const SOURCE_NOTE = `
  <p style="margin:28px 0 0;padding-top:14px;border-top:1px solid #ddd;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888;">
    Fragment from Incunabula: Ong's Hat by Joseph Matheny (2002), licensed CC BY-NC-ND 4.0.
    Full text: <a href="https://archive.org/details/OngsHatTheBeginningJosephMatheny" style="color:#888;">archive.org</a>
  </p>`;

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToParagraphs(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function buildOngshatEmailHtml({ item, siteUrl }) {
  if (item.type === 'image') {
    const imgUrl = `${siteUrl}/ongshat/${item.file}`;
    return `
    <div style="background:#0a0a0a;padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">
        <tr>
          <td style="text-align:center;">
            <img src="${imgUrl}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;border:1px solid #333;" />
          </td>
        </tr>
      </table>
    </div>`;
  }

  const bodyHtml = textToParagraphs(item.text);
  const footer = item.type === 'source' ? SOURCE_NOTE : '';

  return `
  <div style="background:#ffffff;padding:30px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;">
      <tr>
        <td style="font-size:15px;line-height:1.7;color:#1a1a1a;">
          ${bodyHtml}
          ${footer}
        </td>
      </tr>
    </table>
  </div>`;
}

// Numbering is against the original 103-item text sequence (item.id, 0-102),
// not the 122-item combined schedule -- so the numbering stays stable and
// meaningful even though images are threaded in between at their own
// separate positions.
function buildSubject(item) {
  if (item.type === 'source') return `INCUNABULA ${String(item.id + 1).padStart(3, '0')}/103`;
  return '.'; // notes and images both arrive bare, unexplained
}

module.exports = { buildOngshatEmailHtml, buildSubject };
