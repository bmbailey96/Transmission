const { picks, toHear, anticipated } = require('./curated2026');

module.exports = `
# Direct statements from Brandon, September 25, 2026
These are current favorite albums and contenders he actually named. The order is not a ranking and his number one is undecided. Julia Jacklin's The Gem is his only explicit likely-top-five claim. For an exact album below, his judgment takes precedence over a predicted score. Do not use a missing Spotify play or an absent log as negative evidence.
${picks.map(x => `- ${x.artist} — ${x.title}${x.note ? ` (${x.note})` : ''}`).join('\n')}

These albums are merely to hear. Interest is not endorsement:
${toHear.map(x => `- ${x.artist} — ${x.title}`).join('\n')}

These are anticipated, not yet judged:
${anticipated.map(x => `- ${x.artist} — ${x.title}`).join('\n')}
`;
