const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseFathom,parseLocal,inferredDate,safeURL}=require('../lib/rewind/cinema');
const events=parseFathom(fs.readFileSync(__dirname+'/fixtures/fathom.html','utf8'),'2026-10-05');
assert.ok(events.length);const range=events.find(e=>e.ranges.length);assert.ok(range);assert.equal(range.dates.length,0,'A national date window must not invent daily screenings');assert.equal(range.scope,'national');
const local=parseLocal(fs.readFileSync(__dirname+'/fixtures/kalispell.html','utf8'),'2026-10-05');assert.ok(local.length);assert.ok(local[0].screenings.length);assert.ok(local[0].screenings.every(s=>s.date>='2026-10-05'&&s.time&&s.url.startsWith('https://tickets.fandango.com/')));
assert.equal(inferredDate(1,23,'2026-12-25'),'2027-01-23');assert.equal(inferredDate(12,31,'2027-01-02'),'2026-12-31');assert.equal(inferredDate(2,31,'2026-10-05',2027),null);
assert.throws(()=>parseFathom('<h1>blocked</h1>'));assert.throws(()=>parseLocal('<h1>blocked</h1>'));assert.equal(safeURL('https://evil.com/pay',['tickets.fandango.com']),null);
console.log('Cinema: source fixtures, national windows vs exact screenings, ticket hosts, calendar year rollover and layout failures passed');
