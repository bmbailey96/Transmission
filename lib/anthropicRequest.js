function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the Anthropic Messages API expecting a JSON-only response, with retry
 * on transient server errors (5xx, or the request itself failing to even
 * complete) and a fallback that can rescue a JSON object even if some stray
 * reasoning text ends up in front of it.
 *
 * Does NOT retry on 4xx errors (bad request, auth, etc), those won't be fixed
 * by trying again and would just waste time.
 */
async function callAnthropicForJson({
  systemPrompt,
  userMessage,
  model = 'claude-sonnet-4-6',
  maxTokens = 700,
  maxRetries = 2,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env locally, or to Netlify environment variables in production.'
    );
  }

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
    } catch (networkErr) {
      lastError = networkErr;
      if (attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      throw networkErr;
    }

    if (!response.ok) {
      const text = await response.text();
      const isTransient = response.status >= 500 && response.status < 600;
      lastError = new Error(`Anthropic API error ${response.status}: ${text}`);
      if (isTransient && attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      throw lastError;
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
          throw new Error(
            `Could not parse model output as JSON, even after trying to extract just the object. Raw output was: ${cleaned}`
          );
        }
      }
      throw new Error(`Could not parse model output as JSON. Raw output was: ${cleaned}`);
    }
  }

  throw lastError;
}

module.exports = { callAnthropicForJson };
