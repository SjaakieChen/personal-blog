const test=require('node:test'),assert=require('node:assert/strict');
const {merge}=require('../assets/writer-sync.js');
const a={id:'a',title:'First'},b={id:'b',title:'Second'};
test('a stale tab cannot resurrect a deleted draft',()=>{
  const result=merge([a,b],[{...a,title:'Stale edit'},b],{drafts:[b],deleted:['a']},[],()=> 'recovered');
  assert.deepEqual(result.drafts,[b]);assert.deepEqual(result.deleted,['a']);
});
test('independent changes from two tabs both survive',()=>{
  const updatedA={...a,title:'New first'},updatedB={...b,title:'New second'};
  assert.deepEqual(merge([a,b],[updatedA,b],{drafts:[a,updatedB]},[],()=> 'recovered').drafts,[updatedA,updatedB]);
});
test('conflicting edits keep a saved version inside one draft, not a duplicate',()=>{
  const remote={...a,title:'Other tab'};
  const result=merge([a],[{...a,title:'This tab'}],{drafts:[remote]},[],()=> 'recovered');
  assert.deepEqual(result.drafts,[{id:'a',title:'This tab',savedVersions:[remote]}]);
  assert.equal(result.remapped.size,0);
});
test('unchanged saves neither clone drafts nor drop new remote drafts',()=>{
  assert.deepEqual(merge([a],[a],{drafts:[a,b]},[],()=> 'bad').drafts,[a,b]);
});
test('duplicate title drafts consolidate into the newest entry and retain older writing',()=>{
 const old={id:'old',kind:'post',title:'Genesis',updatedAt:'2026-01-01',body:'Earlier text'};
 const latest={id:'new',kind:'post',title:'  GENESIS  ',updatedAt:'2026-01-02',body:'Newer text'};
 const result=merge([], [old,latest],{drafts:[]},[],()=> 'unused');
 assert.equal(result.drafts.length,1);assert.equal(result.drafts[0].id,'new');
 assert.equal(result.drafts[0].savedVersions[0].body,'Earlier text');
 assert.equal(result.remapped.get('old'),'new');assert.deepEqual(result.deleted,['old']);
});
