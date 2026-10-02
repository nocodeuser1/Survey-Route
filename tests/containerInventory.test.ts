import test from 'node:test';
import assert from 'node:assert/strict';
import { getContainerInventory, setContainerInventory, validateContainerCounts, inventorySummary } from '../src/utils/containerInventory.ts';
import { getChecklistAnswer, setChecklistAnswer, countDone, normalizeChecklist, normalizeProgress, DRUMS_ITEM_ID as id, DAY_TANKS_ITEM_ID as tanks } from '../src/utils/siteVisitChecklist.ts';
const at = '2026-10-02T19:00:00Z';
test('old template splits into drums and day tanks; legacy completion invents no inventory', () => {
 const items=normalizeChecklist([{id,label:'Old >55 gallon instruction'}]);
 assert.deepEqual(items.map(x=>x.id),[id,tanks]);
 assert.equal(getContainerInventory({[id]:at},id),null);
 assert.equal(countDone(items,{[id]:at}),0);
 assert.equal(normalizeChecklist(items).length,2);
});
test('yes inventory survives JSON and string-only old-client normalization',()=>{
 const value={answer:'yes' as const,containers:[{gallons:55,quantity:3},{gallons:135.5,quantity:2}]};
 const result=setContainerInventory({ground_photos:at},id,value,at);
 assert.deepEqual(getContainerInventory(normalizeProgress(JSON.parse(JSON.stringify(result))),id),value);
 assert.equal(result.ground_photos,at);
 assert.equal(countDone(normalizeChecklist(null),result),2);
 assert.equal(inventorySummary(value),'55 gal × 3 · 135.5 gal × 2');
});
test('distinct fluids same volume are valid, duplicates and invalid quantities rejected',()=>{
 assert.equal(validateContainerCounts([{gallons:55,quantity:1,contents:'Methanol'},{gallons:55,quantity:2,contents:'Lube oil'}]),null);
 for(const rows of [[{gallons:0,quantity:1}],[{gallons:55,quantity:0}],[{gallons:55,quantity:1.5}],[{gallons:55,quantity:1,contents:''}],[{gallons:55,quantity:1},{gallons:55,quantity:2}]]) assert.ok(validateContainerCounts(rows));
});
test('no and clear remove stale inventory, preserving other item',()=>{
 const initial=setContainerInventory({[tanks]:at},id,{answer:'yes',containers:[{gallons:55,quantity:3}]},at);
 const no=setContainerInventory(initial,id,{answer:'no',containers:[]},at);
 assert.deepEqual(getContainerInventory(no,id),{answer:'no',containers:[]});
 assert.equal(no[`__inventory:${id}`],undefined);
 const cleared=setContainerInventory(no,id,null);
 assert.equal(getContainerInventory(cleared,id),null);assert.equal(cleared[tanks],at);
});
test('legacy recheck invalidates both answer and inventory',()=>{
 const result=setContainerInventory({},id,{answer:'yes',containers:[{gallons:155,quantity:2}]},at);
 result[id]='2026-10-03T12:00:00Z';assert.equal(getContainerInventory(result,id),null);
});

test('presence-only Yes persists independently and counts as complete without inventing details', () => {
 const result = setContainerInventory({}, id, { answer: 'yes', containers: [] }, at);
 const restored = normalizeProgress(JSON.parse(JSON.stringify(result)));
 assert.deepEqual(getContainerInventory(restored, id), { answer: 'yes', containers: [] });
 assert.equal(result[`__inventory:${id}`], undefined);
 assert.equal(countDone(normalizeChecklist(null), restored), 1);
 assert.equal(inventorySummary(getContainerInventory(restored, id)!), 'Yes · details not recorded');
 assert.equal(inventorySummary({ answer: 'no', containers: [] }), 'No');
 assert.equal(getContainerInventory({}, id), null);
 assert.equal(validateContainerCounts([]), null);
});
test('missing, stale or malformed detail metadata never erases a valid presence answer', () => {
 const base = setChecklistAnswer({}, id, 'yes', at);
 for (const raw of [undefined, 'oops', JSON.stringify({ recordedAt: at, containers: [{ gallons: 55, quantity: 0 }] }), JSON.stringify({ recordedAt: '2025-01-01', containers: [{ gallons: 55, quantity: 1 }] })]) {
  const result = { ...base, [`__inventory:${id}`]: raw };
  assert.equal(getChecklistAnswer(result, id), 'yes');
  assert.deepEqual(getContainerInventory(result, id), { answer: 'yes', containers: [] });
 }
});
test('existing deliberate quantity of one survives read and unrelated saves', () => {
 const value = { answer: 'yes' as const, containers: [{ gallons: 55, quantity: 1 }] };
 const progress = setContainerInventory({}, id, value, at);
 assert.deepEqual(getContainerInventory(setChecklistAnswer(progress, tanks, 'yes', at), id), value);
});
