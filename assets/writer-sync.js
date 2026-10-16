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
      const i=result.findIndex(d=>(d.sourcePath && d.sourcePath===draft.sourcePath) || (d.kind===draft.kind && titleKey(d.title)===titleKey(draft.title)));
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
  const api={merge,same,titleKey};root.BlogDraftSync=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
