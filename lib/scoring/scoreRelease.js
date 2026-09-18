const { buildSystemPrompt } = require('./buildSystemPrompt');
const { callAnthropicForJson } = require('../anthropicRequest');
const { getArtistListeningStats, buildListeningHistorySection } = require('./listeningHistory');

/**
 * Keep the model's judgment intact. Scores are rounded and clamped only.
 * The old implementation added a deterministic -4..+4 offset based on the
 * artist/title hash to make repeated round numbers look more varied. That
 * produced fake precision: two identical judgments could receive different
 * scores for no musical reason at all.
 */
function normalizeScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return score;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Catches the exact thing the prompt has repeatedly failed to prevent on
 * its own: literal third-person references to the listener inside the
 * two fields that are supposed to speak directly to them.
 */
const VOICE_VIOLATION_RE = /\bthis person\b|\bthe user\b/i;

function hasVoiceViolation(result) {
  if (!result) return false;
  return VOICE_VIOLATION_RE.test(`${result.headline || ''} ${result.reasoning || ''}`);
}

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
${noLogSection}${buildListeningHistorySection(artist)}

Score this release.`;

  let result = await callAnthropicForJson({ systemPrompt, userMessage, maxTokens: 700 });

  if (hasVoiceViolation(result)) {
    const retryMessage = `${userMessage}

Your previous attempt at this exact release violated the voice rule. You wrote:
headline: "${result.headline}"
reasoning: "${result.reasoning}"
That uses "this person" or "the user" instead of speaking to them as "you." Rewrite both fields addressing them directly as "you" throughout, same facts, same score, just the pronoun and any sentences built around it fixed. Respond with the same JSON format.`;

    try {
      const retryResult = await callAnthropicForJson({ systemPrompt, userMessage: retryMessage, maxTokens: 700 });
      if (retryResult) result = retryResult;
    } catch (err) {
      // keep the original result rather than losing a valid score to a transient retry failure
    }
  }

  if (result && typeof result.score === 'number') {
    result.score = normalizeScore(result.score);
  }

  return result;
}

module.exports = { scoreRelease, normalizeScore, hasVoiceViolation };
