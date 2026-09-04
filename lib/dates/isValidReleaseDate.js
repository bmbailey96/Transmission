/**
 * A release date is only usable once it's a full YYYY-MM-DD calendar date.
 * extractCandidate.js's system prompt tells the model to return a full date
 * or null, but it was caught not following that: a blog post that only said
 * "for September release" came back as releaseDate: "2026-09" instead of
 * null. That partial string is dangerous downstream, not just wrong: plain
 * string comparison (which is what every "has this release date passed"
 * check in this app uses) treats "2026-09" as LESS THAN "2026-09-04",
 * because a prefix sorts before the full string it's a prefix of. So a
 * record like that silently starts reading as "already overdue" the moment
 * the month turns over, weeks or months before anyone actually knows what
 * day it came out, and jumps to the front of the already-released queue.
 *
 * Used both where a release date is first accepted (extractCandidate.js)
 * and defensively wherever a "releaseDate < today" comparison happens, so a
 * bad date from any future source can't repeat this.
 */
function isValidReleaseDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

module.exports = { isValidReleaseDate };
