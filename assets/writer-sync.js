(function(root){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const titleKey=value=>String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  function keepVersion(draft,other){
    const {savedVersions:ignored,...version}=other;
    const versions=[...new Map([...(draft.savedVersions || []),...(other.savedVersions || [])].map(v=>[JSON.stringify(v),v])).values()];
    if(!versions.some(v=>same(v,version)))versions.push(version);
    return {...draft,savedVersions:versions};
  }
  function unique(drafts){
    const result=[],remapped=new Map();
    for(const draft of drafts){
      const i=result.findIndex(d=>(d.sourcePath && d.sourcePath===draft.sourcePath) || (d.recoveredFrom?.id && d.recoveredFrom.id===draft.recoveredFrom?.id) || (!d.recoveredFrom && !draft.recoveredFrom && d.kind===draft.kind && titleKey(d.title)===titleKey(draft.title)));
      if(i<0){result.push(draft);continue;}
      const previous=result[i];
      const newest=(Date.parse(draft.updatedAt)||0)>(Date.parse(previous.updatedAt)||0)?draft:previous;
      const older=newest===draft?previous:draft;
      result[i]=keepVersion(newest,older);remapped.set(older.id,newest.id);
    }
    for(const [old,id] of remapped){let target=id;while(remapped.has(target))target=remapped.get(target);remapped.set(old,target);}
    return {drafts:result,remapped};
  }
  function merge(base,local,remote,deleted,makeId){
    const removed=new Set([...(remote.deleted || []),...deleted]);
    const old=new Map(base.map(d=>[d.id,d]));
    const result=new Map(remote.drafts.filter(d=>!removed.has(d.id)).map(d=>[d.id,d]));
    const remapped=new Map();
    for(const draft of local){
      if(removed.has(draft.id))continue;
      const previous=old.get(draft.id),latest=result.get(draft.id);
      if(same(draft,previous)){
        if(same(draft,latest))result.set(draft.id,draft);
        continue;
      }
      if(!latest || same(latest,previous) || same(latest,draft))result.set(draft.id,draft);
      else result.set(draft.id,keepVersion(draft,latest));
    }
    const deduped=unique([...result.values()]);
    for(const [old,id] of deduped.remapped){remapped.set(old,id);removed.add(old);}
    return {drafts:deduped.drafts,deleted:[...removed],remapped};
  }
  function validPublishedIndex(data,requireRevision=false) {
    if(!data || !Array.isArray(data.posts) || !Array.isArray(data.pages))return false;
    const entries=[...data.posts,...data.pages];
    return entries.every(entry=>entry && typeof entry.title==='string' && typeof entry.html==='string' && /^(?:_posts|pages)\/[a-zA-Z0-9_-]+\.md$/.test(entry.path) && ['post','page'].includes(entry.kind) && (!requireRevision || /^[a-f0-9]{40}$/.test(entry.sourceSha))) && new Set(entries.map(entry=>entry.path)).size===entries.length;
  }
  function reconcileMissing(drafts, paths, fingerprint, makeId, now=new Date().toISOString()) {
    const live=new Set(paths), missing=drafts.filter(d=>d.sourcePath && !live.has(d.sourcePath));
    const result=drafts.filter(d=>!missing.includes(d)), deleted=[], remapped=new Map();
    let recovered=0;
    const signature=d=>{try{return fingerprint(d);}catch{return null;}};
    for(const draft of missing) {
      const writing=signature(draft);
      const survivor=writing===null?-1:result.findIndex(other=>[other,...(other.savedVersions || [])].some(version=>signature(version)===writing));
      if(survivor>=0) {
        // Keep the complete legacy snapshot, including source identity and history.
        result[survivor]=keepVersion(result[survivor],draft);
        remapped.set(draft.id,result[survivor].id);
      }else if(writing===null || draft.publishedFingerprint!==writing) {
        const replacement=keepVersion({...draft,id:makeId(),referenceKey:draft.referenceKey || draft.id},draft);
        replacement.recoveredFrom={id:draft.id,path:draft.sourcePath,sha:draft.sourceSha || null,at:now};
        for(const field of ['sourcePath','sourceSha','targetPath','originalDate','permalink','publishedFingerprint','publishedAt','editedAt','pendingPublication','conflict'])delete replacement[field];
        result.push(replacement);remapped.set(draft.id,replacement.id);recovered++;
      }
      // A new identity plus this tombstone prevents stale tabs restoring old routing.
      deleted.push(draft.id);
    }
    return {drafts:result,deleted,remapped,recovered};
  }
  const api={merge,same,titleKey,validPublishedIndex,reconcileMissing};root.BlogDraftSync=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
