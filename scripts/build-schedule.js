/**
 * Converts the real 1999–2026 timeline into day-offsets from an eventual
 * activation date, compressing the main Sept 2004–Jan 2006 arc into
 * MAIN_ARC_TARGET_DAYS while preserving every gap's real proportion —
 * so the ~289-day silence between Part 4 and Part 5 stays the longest
 * silence by far, relative to everything else, even compressed.
 *
 * The epilogue (2014) and finale (Case Notes) aren't part of that
 * compression — they get their own deliberate gaps after the main arc
 * ends, since they're not really "paced" content, they're aftermath.
 *
 * Output: data/schedule.json — every item from timeline.js, plus a
 * `dayOffset` (float, days from activation) and `contentFile` pointing
 * at where its real text will eventually live.
 *
 * Usage: node scripts/build-schedule.js > data/schedule.json
 */

const { TIMELINE } = require('../data/timeline');

const MAIN_ARC_TARGET_DAYS = 90; // ~3 months. Change this and re-run to retime everything.
const EPILOGUE_GAP_DAYS = 14; // deliberate pause after the main arc ends, before "eight years pass"
const FINALE_GAP_DAYS = 2; // short gap after the epilogue, before the closing case notes

function parseDate(s) {
  return new Date(s + (s.includes('T') ? '' : 'T00:00:00'));
}

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function buildSchedule() {
  const EPILOGUE_IDS = ['p6-2014-original', 'p6-2014-update1', 'p6-2014-update2'];
  // Main arc = everything through the Loreen-followup absence marker.
  // Epilogue is handled separately below.
  const mainArc = TIMELINE
    .filter((item) => !EPILOGUE_IDS.includes(item.id))
    .sort((a, b) => parseDate(a.realDate) - parseDate(b.realDate));
  const epilogueItems = TIMELINE
    .filter((item) => EPILOGUE_IDS.includes(item.id))
    .sort((a, b) => parseDate(a.realDate) - parseDate(b.realDate));

  const firstDate = parseDate(mainArc[0].realDate);
  const lastDate = parseDate(mainArc[mainArc.length - 1].realDate);
  const totalRealDays = daysBetween(firstDate, lastDate);
  const scale = MAIN_ARC_TARGET_DAYS / totalRealDays;

  const schedule = mainArc.map((item) => {
    const itemDate = parseDate(item.realDate);
    const realOffsetDays = daysBetween(firstDate, itemDate);
    const dayOffset = Math.round(realOffsetDays * scale * 1000) / 1000; // keep 3 decimal places (fractions of a day matter for the SMS burst)
    return {
      ...item,
      dayOffset,
      contentFile: item.absence ? null : `content/${item.id}.txt`,
      sent: false,
    };
  });

  const lastMainOffset = schedule[schedule.length - 1].dayOffset;

  // Space the three Part 6 pieces a few days apart from each other (their
  // real gaps aren't documented, so this is pacing only), then the finale
  // shortly after the last one.
  const epilogueSpacingDays = { 'p6-2014-original': 0, 'p6-2014-update1': 4, 'p6-2014-update2': 8 };

  for (const item of epilogueItems) {
    const extra = EPILOGUE_GAP_DAYS + (epilogueSpacingDays[item.id] ?? 0);
    schedule.push({
      ...item,
      dayOffset: Math.round((lastMainOffset + extra) * 1000) / 1000,
      contentFile: `content/${item.id}.txt`, // Brandon's own writing (his summary + case notes) — pasted in the same way as everything else
      sent: false,
    });
  }

  return schedule;
}

const schedule = buildSchedule();
console.error(`Built schedule: ${schedule.length} items, spanning ${schedule[schedule.length - 1].dayOffset.toFixed(1)} days total.`);
process.stdout.write(JSON.stringify(schedule, null, 2));
