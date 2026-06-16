const { buildSystemPrompt } = require('./buildSystemPrompt');

const MODEL = 'claude-sonnet-4-6';

async function scoreRelease({ artist, title, evidenceText, recentNoLog = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env locally, or to Netlify environment variables in production.'
    );
  }

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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const raw = data.content.find((b) => b.type === 'text')?.text || '';
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        throw new Error(`Could not parse model output as JSON, even after trying to extract just the object. Raw output was: ${cleaned}`);
      }
    }
    throw new Error(`Could not parse model output as JSON. Raw output was: ${cleaned}`);
  }
}

module.exports = { scoreRelease };
