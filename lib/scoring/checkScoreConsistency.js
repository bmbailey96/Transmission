const { callAnthropicForJson } = require('../anthropicRequest');

function buildConsistencyPrompt({ headline, reasoning, score }) {
  return `You're reviewing a written music assessment to check whether it's internally consistent with the numeric score it received.

Score given: ${score}/100

Headline: ${headline}

Reasoning: ${reasoning}

Read the reasoning on its own terms, setting the score aside at first. Does the actual argument made in the text support a score this high? Watch especially for reasoning that raises real, substantive reservations, comparisons that cut against the album (weaker execution than the artists who actually anchor this person's taste, a different quality of ambition, glossier or more polished than what they respond to) and then still lands on a number that reads as a recommendation anyway. The same check applies in reverse: text that sounds more enthusiastic than a low score would suggest.

A few positive notes inside an otherwise skeptical case don't make the score consistent, what matters is the overall argument's direction and weight, not whether any praise appears at all.

Respond with JSON only, no other text, no markdown fences:
{
  "consistent": true or false,
  "direction": "score_too_high" or "score_too_low" or "consistent",
  "explanation": "one or two sentences on what in the text drove this",
  "suggestedScore": a number 0-100 representing what the text itself actually argues for
}`;
}

/**
 * Independently re-derives what score the reasoning text itself supports,
 * separate from whatever number the original scoring call produced. Cheap,
 * no search needed, this is purely a consistency check on existing prose.
 */
async function checkScoreConsistency({ headline, reasoning, score }) {
  const prompt = buildConsistencyPrompt({ headline, reasoning, score });
  const result = await callAnthropicForJson({
    systemPrompt: 'You are a careful editor checking a single piece of writing for internal consistency. Respond with JSON only.',
    userMessage: prompt,
    maxTokens: 300,
  });

  return {
    consistent: result.consistent !== false,
    direction: result.direction || 'consistent',
    explanation: result.explanation || '',
    suggestedScore: typeof result.suggestedScore === 'number' ? result.suggestedScore : score,
  };
}

module.exports = { checkScoreConsistency, buildConsistencyPrompt };
