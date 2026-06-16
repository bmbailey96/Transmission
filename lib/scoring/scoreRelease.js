const { buildSystemPrompt } = require('./buildSystemPrompt');
const { callAnthropicForJson } = require('../anthropicRequest');

/**
 * @param {Object} params
 * @param {string} params.artist
 * @param {string} params.title
 * @param {string} [params.evidenceText] - anything real and public about this specific release
 * @param {Array<{artist:string, title:string, score:number, reasoning:string, userNote?:string}>} [params.recentNoLog]
 * @returns {Promise<{score:number, headline:string, reasoning:string, evidenceLevel:string}>}
 */
async function scoreRelease({ artist, title, evidenceText, recentNoLog = [] }) {
  const systemPrompt = buildSystemPrompt();

  let noLogSection = '';
  if (recentNoLog.length > 0) {
    noLogSection =
      `\n\n# Recent releases this person explicitly said no to, despite a high score\n` +
      recentNoLog
        .map(
          (n) =>
            `- ${n.artist} - ${n.title}: scored ${n.score}, reasoning was "${n.reasoning}"${
              n.userNote ? ` (their note: "${n.userNote}")` : ''
            }`
        )
        .join('\n');
  }

  const userMessage = `Candidate release:
Artist: ${artist}
Title: ${title}

Evidence available:
${evidenceText || '(nothing beyond the announcement itself: artist, title, and a date)'}
${noLogSection}

Score this release.`;

  return callAnthropicForJson({ systemPrompt, userMessage, maxTokens: 700 });
}

module.exports = { scoreRelease };
