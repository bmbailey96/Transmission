const assert = require('node:assert/strict');
const {eventsFor,pendingEvents} = require('../lib/rewind/availability');
const netflix = {provider_id:8,provider_name:'Netflix'};
const max = {provider_id:1899,provider_name:'HBO Max'};
const before = eventsFor({flatrate:[netflix]},[], '2026-10-04');
const after = eventsFor({flatrate:[netflix,max]},[], '2026-10-04');
assert.equal(pendingEvents(after,before.map(e=>e.key))[0].label,'Included with HBO Max');
assert.deepEqual(pendingEvents(after,after.map(e=>e.key)),[]);
assert.equal(eventsFor({rent:[netflix]},[])[0].label,'Rent on Netflix');
assert.equal(eventsFor({flatrate:[{provider_id:2,provider_name:'AMC Plus Amazon Channel'}]},[])[0].label,'Separate subscription: AMC Plus Amazon Channel (add-on channel)');
const dates = [{type:3,release_date:'2026-10-05T00:00:00Z'}];
const future = eventsFor({},dates,'2026-10-04');
assert.equal(pendingEvents(eventsFor({},dates,'2026-10-05'),future.map(e=>e.key)).length,1);
assert.match(future[0].label,/US theatrical scheduled/);
console.log('Rewind alert changes and deduplication passed');

assert.equal(eventsFor({ads:[{provider_id:73,provider_name:'Tubi'}]},[])[0].label,'Free with ads on Tubi');
assert.equal(eventsFor({flatrate:[{provider_id:1,provider_name:'HBO Max Amazon Channel'}]},[])[0].label,'Separate subscription: HBO Max Amazon Channel (add-on channel)');
