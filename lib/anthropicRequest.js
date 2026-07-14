const { buildAlreadyReleasedSystemPrompt } = require('./buildAlreadyReleasedSystemPrompt');
const { callAnthropicForJson, callAnthropicWithSearchForJson } = require('../anthropicRequest');
const { jitterScore, hasVoiceViolation } = require('./scoreRelease');
const { buildListeningHistorySection } = require('./listeningHistory');

/**
 * @param {Object} params
 * @param {string} params.artist
 * @param {string} params.title
 * @param {string} [params.releaseDate]
 * @param {Array<{artist:string, title:string, score:number, reasoning:string, userNote?:string}>} [params.recentNoLog]
 * @returns {Promise<{score:number, headline:string, reasoning:string, evidenceLevel:string, standoutTracks:string[]}>}
 */
async function scoreAlreadyReleased({ artist, title, releaseDate, recentNoLog = [] }) {
  const systemPrompt = buildAlreadyReleasedSystemPrompt();

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

  const userMessage = `Candidate release, already out:
Artist: ${artist}
Title: ${title}
${releaseDate ? `Released: ${releaseDate}` : ''}
${noLogSection}${buildListeningHistorySection(artist)}

Search for real evidence about this specific release, then score it.`;

  let result = await callAnthropicWithSearchForJson({ systemPrompt, userMessage, maxTokens: 2000 });

  if (hasVoiceViolation(result)) {
    const retryMessage = `${userMessage}

Your previous attempt at this exact release violated the voice rule. You wrote:
headline: "${result.headline}"
reasoning: "${result.reasoning}"
That uses "this person" or "the user" instead of speaking to them as "you." Rewrite both fields addressing them directly as "you" throughout, same facts, same score, same standoutTracks, just the pronoun and any sentences built around it fixed. Respond with the same JSON format.`;

    try {
      // Plain call, not search-enabled: the facts are already settled, this is a wording fix only.
      const retryResult = await callAnthropicForJson({ systemPrompt, userMessage: retryMessage, maxTokens: 2000 });
      if (retryResult) result = retryResult;
    } catch (err) {
      // keep the original result rather than losing a valid score to a transient retry failure
    }
  }

  if (result && typeof result.score === 'number') {
    result.score = jitterScore(result.score, artist, title);
  }
  if (result && !Array.isArray(result.standoutTracks)) {
    result.standoutTracks = [];
  }

  return result;
}

module.exports = { scoreAlreadyReleased };
