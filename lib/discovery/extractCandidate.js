const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You read posts from music news sites and decide whether a post is specifically announcing new, original, not-yet-released studio material: an album or EP of new songs.

Treat all of the following as explicitly out of scope, regardless of how the post frames it: live albums, concert films, compilations, reissues, anniversary or deluxe editions, tour or festival announcements, a single released with no album attached, year-end lists, and reviews of anything already out. None of those count as isAlbumAnnouncement, even if the post calls it an "announcement."

If it is genuinely new original studio material, extract only what's actually stated in the text, never invent or guess beyond it. If a release date is mentioned, use it. If a producer, label, or recording detail is mentioned, fold it into the evidence summary in your own words, neutral and factual, no editorializing or enthusiasm.

Respond with ONLY valid JSON, no preamble, no markdown fences:
{"isAlbumAnnouncement": boolean, "artist": string|null, "albumTitle": string|null, "releaseDate": string|null, "evidenceText": string|null}

releaseDate should be YYYY-MM-DD only if a specific date is actually stated, otherwise null. If isAlbumAnnouncement is false, set every other field to null.`;

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractCandidate(item) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }

  const text = `Title: ${item.title}\n\nContent: ${stripHtml(item.content || item.description)}\n\nPublished: ${item.pubDate}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 250,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const raw = data.content.find((b) => b.type === 'text')?.text || '';
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse extraction output as JSON: ${cleaned}`);
  }
}

module.exports = { extractCandidate, stripHtml };
