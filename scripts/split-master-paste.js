/**
 * Splits dionaea_house.txt into the individual content/<id>.txt files.
 * Never prints the actual narrative text to the console — only IDs,
 * dates, character offsets, and match/no-match status. The prose moves
 * from the input file to the output files entirely inside this script;
 * it doesn't pass through anything that gets read aloud or retyped.
 *
 * Anchoring strategy, since blank-line splitting is unreliable (some
 * entries have internal blank lines):
 *   - Email-type entries: anchored on a "date:" line (preceded nearby by
 *     a "from:" line), matched to a schedule item by parsing the actual
 *     date/time and comparing to schedule.json's realDate.
 *   - LJ/blog entries: anchored on the real subject title text, which was
 *     correctly extracted from the epub earlier (unlike some of the
 *     early email subject labels, which were guesses).
 *   - Site frontpage: anchored on the date "10.7.2004".
 *   - AIM log: anchored on "Session Start".
 *
 * Usage: node scripts/split-master-paste.js dionaea_house.txt
 */

const fs = require('fs');
const path = require('path');
const schedule = require('../data/schedule.json');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node split-master-paste.js <path-to-master-file>');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');

// Build a lookup of character offset -> line start, so we can convert
// line-based anchors into character offsets for slicing.
const lineOffsets = [];
{
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1; // +1 for the \n
  }
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseHeaderDate(str) {
  // Matches: "Monday, September 06, 2004 8:17 AM"
  const m = str.match(/(\w+),\s*(\w+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const [, , monthName, day, year, hourStr, min, ampm] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return null;
  let hour = parseInt(hourStr, 10) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  return new Date(parseInt(year, 10), month, parseInt(day, 10), hour, parseInt(min, 10));
}

const anchors = []; // { offset, matchedId, note }

// --- Email-type anchors: "date:" lines near a "from:" line ---
lines.forEach((line, i) => {
  const dateMatch = line.match(/^date:\s*(.+)$/i);
  if (!dateMatch) return;
  // require a "from:" line within the previous 3 lines
  const hasFrom = lines.slice(Math.max(0, i - 3), i).some((l) => /^from:/i.test(l));
  if (!hasFrom) return;

  const parsed = parseHeaderDate(dateMatch[1]);
  if (!parsed) {
    anchors.push({ offset: lineOffsets[Math.max(0, i - 3)], matchedId: null, note: `unparseable date near line ${i + 1}` });
    return;
  }

  // Find the closest schedule item (email/bounce type) by real date/time.
  let best = null;
  let bestDiff = Infinity;
  for (const item of schedule) {
    if (item.type !== 'email' && item.type !== 'bounce') continue;
    const itemDate = new Date(item.realDate);
    const diff = Math.abs(itemDate.getTime() - parsed.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = item;
    }
  }
  const startLine = Math.max(0, i - 3); // back up to include the "from:" line
  const withinTolerance = bestDiff < 1000 * 60 * 5; // 5-minute tolerance
  anchors.push({
    offset: lineOffsets[startLine],
    matchedId: withinTolerance ? best.id : null,
    note: withinTolerance ? null : `closest match ${best ? best.id : 'none'} off by ${(bestDiff / 60000).toFixed(1)} min — not auto-assigned`,
  });
});

// --- Subject-title anchors (LJ/blog entries with confirmed real titles) ---
// Search only after each section's own page-header line, not from the very
// start of the file — otherwise an earlier mention of the same title
// elsewhere (e.g. a comment that quotes "Early Start" by name before the
// real entry appears) gets matched instead of the actual entry.
const ljSectionStart = (() => {
  const idx = raw.indexOf('ohdanigirl.livejournal.com');
  return idx === -1 ? 0 : idx;
})();
const blogSectionStart = (() => {
  const idx = raw.indexOf('dionaeahouse.blogspot.com');
  return idx === -1 ? 0 : idx;
})();

for (const item of schedule) {
  if (item.type !== 'lj' && item.type !== 'blog') continue;
  if (!item.subject) continue;
  const searchFrom = item.type === 'lj' ? ljSectionStart : blogSectionStart;
  const idx = raw.indexOf(item.subject, searchFrom);
  if (idx === -1) continue;
  const lineStart = raw.lastIndexOf('\n', idx) + 1;
  anchors.push({ offset: lineStart, matchedId: item.id, note: null });
}

// --- Site frontpage anchor ---
{
  const idx = raw.indexOf('10.7.2004');
  if (idx !== -1) {
    const lineStart = raw.lastIndexOf('\n', idx) + 1;
    anchors.push({ offset: lineStart, matchedId: 'p1-site', note: null });
  }
}

// --- SMS-type anchors: "from: [removed]@messaging.sprintpcs.com | date: ..." ---
// Different header shape than regular emails — from/date/subject all on one
// (sometimes line-wrapped) line, joined by pipes. The Sept 21 cluster gets
// merged into a single anchor (matching the schedule's grouped burst item);
// the isolated Sept 16 one gets its own.
{
  let sept21BurstAnchorAdded = false;
  lines.forEach((line, i) => {
    if (!/from:\s*\[removed\]@messaging\.sprintpcs\.com/i.test(line)) return;
    // Date may wrap onto the next line — join a small window to parse it reliably.
    const joined = lines.slice(i, i + 2).join(' ');
    const parsed = parseHeaderDate(joined);
    if (!parsed) return;

    const isSept21 = parsed.getMonth() === 8 && parsed.getDate() === 21 && parsed.getFullYear() === 2004;
    if (isSept21) {
      if (sept21BurstAnchorAdded) return; // only the first Sept 21 text starts the anchor; the rest ride along in the same chunk
      sept21BurstAnchorAdded = true;
      anchors.push({ offset: lineOffsets[i], matchedId: 'p2-0921-burst', note: null });
    } else {
      // Match against schedule's sms-single item by nearest date.
      anchors.push({ offset: lineOffsets[i], matchedId: 'p2-0916-sms1', note: null });
    }
  });
}

// --- AIM log anchor ---
{
  const idx = raw.indexOf('AIM Chatlog');
  if (idx !== -1) {
    const lineStart = raw.lastIndexOf('\n', idx) + 1;
    anchors.push({ offset: lineStart, matchedId: 'p2-aimlog', note: null });
  }
}

// --- Danielle's comment on Eric's blog ---
{
  const idx = raw.indexOf('Comment left on Eric');
  if (idx !== -1) {
    const lineStart = raw.lastIndexOf('\n', idx) + 1;
    anchors.push({ offset: lineStart, matchedId: 'p4-danielle-comment', note: null });
  }
}

// --- Part 6 (2014 post + 2 updates) anchors ---
{
  const idx = raw.indexOf('nosleep');
  if (idx !== -1) {
    const lineStart = raw.lastIndexOf('\n', idx) + 1;
    anchors.push({ offset: lineStart, matchedId: 'p6-2014-original', note: null });
  }
}
{
  // The two UPDATE markers inside the 2014 post — matched by exact line
  // number rather than text search, since "Update:"/"UPDATE:" also appears
  // earlier in the file (in the separate updates.htm material) and a plain
  // text search would grab the wrong occurrence.
  const targetLines = [1801, 1903]; // 1-indexed, matches raw.split('\n') at index-1
  const ids = ['p6-2014-update1', 'p6-2014-update2'];
  targetLines.forEach((lineNum, i) => {
    const offset = lineOffsets[lineNum - 1];
    if (offset !== undefined) {
      anchors.push({ offset, matchedId: ids[i], note: null });
    }
  });
}

anchors.sort((a, b) => a.offset - b.offset);

// --- Slice the file between consecutive anchors, write matched ones ---
const contentDir = path.join(__dirname, '..', 'content');
let written = 0;
let unmatched = 0;

for (let i = 0; i < anchors.length; i++) {
  const start = anchors[i].offset;
  const end = i + 1 < anchors.length ? anchors[i + 1].offset : raw.length;
  const chunk = raw.slice(start, end).trim();

  if (!anchors[i].matchedId) {
    unmatched++;
    console.log(`UNMATCHED anchor at offset ${start} (${chunk.length} chars) — ${anchors[i].note || 'no note'}`);
    continue;
  }

  const filePath = path.join(contentDir, `${anchors[i].matchedId}.txt`);
  fs.writeFileSync(filePath, chunk + '\n');
  written++;
  console.log(`WROTE  ${anchors[i].matchedId}.txt  (${chunk.length} chars)`);
}

console.log();
console.log(`Total anchors found: ${anchors.length}`);
console.log(`Written: ${written}, Unmatched: ${unmatched}`);

const allIds = schedule.filter((i) => i.contentFile).map((i) => i.id);
const foundIds = new Set(anchors.filter((a) => a.matchedId).map((a) => a.matchedId));
const stillMissing = allIds.filter((id) => !foundIds.has(id));
console.log();
console.log(`Still missing (${stillMissing.length}):`, stillMissing.join(', '));
