const test=require('node:test'),assert=require('node:assert/strict');
const {merge,reconcileMissing,validPublishedIndex}=require('../assets/writer-sync.js');
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

const writing=d=>JSON.stringify([d.kind,d.title,d.quote || '',d.doc]);
const make=(id,title,text)=>({id,kind:'post',title,quote:'',doc:[{runs:[{text}]}]});
test('legacy orphans match retained writing, preserve full snapshots, and cannot return from a stale tab',()=>{
 const orphan={...make('orphan','Genesis','test'),sourcePath:'_posts/old.md',sourceSha:'old',savedVersions:[make('older','Genesis','Earlier')]};
 const live={...make('live','Renamed post','Current writing'),sourcePath:'_posts/current.md',savedVersions:[make('copy','Genesis','test')]};
 const original=structuredClone([orphan,live]);
 const result=reconcileMissing(original,['_posts/current.md'],writing,()=>assert.fail('No replacement needed'));
 assert.deepEqual(original,[orphan,live],'reconciliation does not mutate its inputs');
 assert.equal(result.drafts.length,1);assert.equal(result.drafts[0].id,'live');
 assert.ok(result.drafts[0].savedVersions.some(v=>v.id==='orphan' && v.sourceSha==='old'));
 assert.ok(result.drafts[0].savedVersions.some(v=>v.id==='older'));
 assert.deepEqual(result.deleted,['orphan']);assert.equal(result.remapped.get('orphan'),'live');
 const stale=merge(original,original,{drafts:result.drafts,deleted:result.deleted},[],()=> 'unused');
 assert.deepEqual(stale.drafts,result.drafts);assert.deepEqual(stale.deleted,['orphan']);
});
test('unmatched edits and fingerprint-free legacy writing recover with original provenance and new identity',()=>{
 for(const extra of [{},{publishedFingerprint:'an older published version'}]){
  const source={...make('old','Same title','New private writing'),...extra,sourcePath:'_posts/deleted.md',sourceSha:'abc',targetPath:'_posts/deleted.md',permalink:'/deleted/',originalDate:'2026-01-01',publishedAt:'2026-01-01',pendingPublication:{content:'obsolete request'},savedVersions:[make('previous','Same title','Previous writing')]};
  const result=reconcileMissing([source],[],writing,()=> 'recovered','2026-10-21T12:00:00Z'), recovered=result.drafts[0];
  assert.equal(recovered.id,'recovered');assert.deepEqual(recovered.doc,source.doc);assert.equal(recovered.title,source.title);
  assert.equal(recovered.recoveredFrom.path,source.sourcePath);assert.equal(recovered.referenceKey,source.id);
  for(const key of ['sourcePath','sourceSha','targetPath','permalink','originalDate','publishedAt','publishedFingerprint','pendingPublication'])assert.equal(recovered[key],undefined,key);
  assert.ok(recovered.savedVersions.some(v=>v.id==='old' && v.pendingPublication.content==='obsolete request'));
  assert.ok(recovered.savedVersions.some(v=>v.id==='previous'));
  assert.deepEqual(result.deleted,['old']);assert.equal(result.remapped.get('old'),'recovered');
  const stale=merge([source],[source],{drafts:result.drafts,deleted:result.deleted},[],()=> 'unused');
  assert.deepEqual(stale.drafts,[recovered]);
 }
});
test('known unchanged deleted publications stay deleted while live records are left alone',()=>{
 const clean={...make('clean','Deleted publication','Published writing'),sourcePath:'_posts/deleted.md'};clean.publishedFingerprint=writing(clean);
 const live={...make('live','Live publication','Private edits'),sourcePath:'_posts/live.md'};
 const result=reconcileMissing([clean,live],['_posts/live.md'],writing,()=>assert.fail('No recovery needed'));
 assert.deepEqual(result.drafts,[live]);assert.deepEqual(result.deleted,['clean']);assert.equal(result.recovered,0);
});
test('recovered writing is not deduplicated into a live publication merely because the title matches',()=>{
 const recovered={...make('recovered','Shared title','Private edits'),recoveredFrom:{id:'orphan',path:'_posts/old.md'}};
 const live={...make('live','Shared title','Live writing'),sourcePath:'_posts/live.md'};
 assert.deepEqual(merge([], [recovered,live],{drafts:[]},[],()=> 'unused').drafts,[recovered,live]);
});
test('two tabs recovering the same orphan consolidate their replacement IDs and retain later writing',()=>{
 const first={...make('recovered-a','Recovered','Original words'),recoveredFrom:{id:'orphan'},updatedAt:'2026-10-21T12:00:00Z'};
 const second={...make('recovered-b','Recovered','Newer private words'),recoveredFrom:{id:'orphan'},updatedAt:'2026-10-21T12:01:00Z'};
 const result=merge([], [second],{drafts:[first],deleted:['orphan']},[],()=> 'unused');
 assert.equal(result.drafts.length,1);assert.equal(result.drafts[0].id,'recovered-b');
 assert.deepEqual(result.drafts[0].savedVersions,[first]);assert.equal(result.remapped.get('recovered-a'),'recovered-b');
 assert.deepEqual(result.deleted,['orphan','recovered-a']);
});
test('partial or malformed publication indexes cannot authorize reconciliation',()=>{
 const entry={path:'_posts/live.md',kind:'post',title:'Live',html:'<p>Text</p>'};
 assert.equal(validPublishedIndex({posts:[entry],pages:[]}),true);
 assert.equal(validPublishedIndex({posts:[entry],pages:[]},true),false,'private index requires source revisions');
 assert.equal(validPublishedIndex({posts:[{...entry,sourceSha:'a'.repeat(40)}],pages:[]},true),true);
 assert.equal(validPublishedIndex({posts:[],pages:[]}),true);
 for(const index of [null,{}, {posts:[]},{pages:[]},{posts:null,pages:[]},{posts:[entry,entry],pages:[]},{posts:[{...entry,html:null}],pages:[]},{posts:[{...entry,path:'../outside.md'}],pages:[]}])assert.equal(validPublishedIndex(index),false);
});
