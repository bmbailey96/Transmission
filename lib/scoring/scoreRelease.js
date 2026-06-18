const { buildSystemPrompt } = require('./buildSystemPrompt');
const { callAnthropicForJson } = require('../anthropicRequest');

/**
 * Small deterministic string hash (same input always produces the same
 * output, no Math.random involved). Used to derive a per-release jitter
 * so the same artist/title always lands on the same final score, but two
 * different releases that the model happened to both call "70" don't show
 * up identically.
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Nudges a raw model score by a small, deterministic, per-release offset
 * (-4 to +4) derived from the artist/title themselves, then clamps back
 * into 0-100. This exists because the model has a persistent pull toward
 * a handful of specific numbers (round or not) regardless of prompt
 * instructions telling it not to, so unrelated releases were ending up
 * with the literal identical score. The jitter doesn't override the
 * model's judgment, a release it scored low stays low and one it scored
 * high stays high, it just restores the kind of point-to-point variation
 * that judgment almost certainly already has but the model's raw number
 * doesn't reliably express on its own.
 */
function jitterScore(score, artist, title) {
  if (typeof score !== 'number' || Number.isNaN(score)) return score;
  const hash = hashString(`${artist || ''}::${title || ''}`);
  const offset = (hash % 9) - 4; // -4..+4 inclusive
  return Math.max(0, Math.min(100, Math.round(score) + offset));
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
${noLogSection}

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
    result.score = jitterScore(result.score, artist, title);
  }

  return result;
}

module.exports = { scoreRelease, jitterScore, hasVoiceViolation };

