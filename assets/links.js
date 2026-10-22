(() => {
  function samePage(link) {
    try {
      const destination=new URL(link.href,location.href), current=new URL(location.href);
      return destination.origin===current.origin && destination.pathname===current.pathname && destination.search===current.search;
    }catch{return false;}
  }
  function update(link) {
    // Repair old published markers as well as newly inserted editor links.
    if(link.closest('.citation')){
      const match=link.textContent.match(/^\[(\d+)(?:,\s*([\s\S]*))?\]$/);
      if(match){
        if(match[2] && !link.title)link.title=match[2];
        const label='['+match[1]+']';if(link.textContent!==label)link.textContent=label;
      }
    }
    const feedNavigation=link.hasAttribute('data-feed-navigation') && new URL(link.href,location.href).origin===location.origin;
    if(samePage(link) || feedNavigation)link.removeAttribute('target');
    else {link.target='_blank';link.rel=[...new Set([...link.relList,'noopener','noreferrer'])].join(' ');}
  }
  function scan(root) {
    if(root.nodeType!==Node.ELEMENT_NODE && root!==document)return;
    if(root.matches?.('a[href]'))update(root);
    root.querySelectorAll('a[href]').forEach(update);
  }
  function mediaTarget(hash,scope=document) {
    try {
      const target=hash && scope.querySelector('#'+CSS.escape(decodeURIComponent(hash.slice(1))));
      return target?.closest('.post-media')?target:null;
    }catch{return null;}
  }
  function revealMedia(target) {
    target.dispatchEvent(new CustomEvent('blog-media-reveal',{bubbles:true,detail:{target}}));
    target.scrollIntoView({block:'start'});
  }
  // Native fragment history does not consistently restore the independently
  // scrolling reading pane. Keep its position per entry without replacing
  // other application history state or writing state on every scroll event.
  const scrollKey='blogMainScrollEntry',positions=new Map();
  let entry=0,activeEntry=null,restoring=false,restoration=0;
  const main=()=>document.querySelector('.main');
  function rememberScroll() {
    const pane=main();
    if(!restoring && pane && activeEntry && history.state?.[scrollKey]===activeEntry)
      positions.set(activeEntry,{top:pane.scrollTop,left:pane.scrollLeft});
  }
  function newEntryState() {
    activeEntry=Date.now().toString(36)+'-'+(++entry);
    return {...history.state,[scrollKey]:activeEntry};
  }
  function identifyEntry() {
    if(!main())return;
    activeEntry=history.state?.[scrollKey] || null;
    if(!activeEntry)history.replaceState(newEntryState(),'');
    rememberScroll();
  }
  identifyEntry();
  document.addEventListener('scroll',event=>{if(event.target===main())rememberScroll();},true);
  // Capture the reading position before feed expansion or media navigation.
  window.addEventListener('click',event=>{
    if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)rememberScroll();
  },true);
  window.addEventListener('popstate',event=>{
    const position=positions.get(event.state?.[scrollKey]);
    activeEntry=event.state?.[scrollKey] || null;
    const token=++restoration;restoring=!!position;
    if(!position)return;
    // Hash handlers reveal collapsed prose and media on the next layout frame.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(token!==restoration)return;
      main()?.scrollTo({top:position.top,left:position.left,behavior:'instant'});
      requestAnimationFrame(()=>{if(token===restoration){restoring=false;rememberScroll();}});
    }));
  });
  window.BlogLinks={samePage};
  scan(document);
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')update(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');
    if(!link)return;
    update(link);
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    const image=window.BlogEvidenceMedia?.imageTarget?.(link);
    if(image && !samePage(link)){event.preventDefault();revealMedia(image);return;}
    const destination=new URL(link.href,location.href);
    if(!samePage(link)){
      // A normal click inside contenteditable selects the link by default.
      // Keep the writing desk's complete documents and other source links usable.
      if(link.target==='_blank' && link.closest('.post-body[contenteditable="true"]') && ['https:','http:'].includes(destination.protocol)){
        event.preventDefault();window.open(destination.href,'_blank','noopener,noreferrer');
      }
      return;
    }
    const target=mediaTarget(destination.hash,link.closest('.post') || document);
    if(!target)return;
    // Editable links otherwise select text instead of following the figure.
    // Reveal a hidden carousel page before the browser computes its position.
    event.preventDefault();
    if(location.hash!==destination.hash)history.pushState(main()?newEntryState():history.state,'',destination.href);
    revealMedia(target);
    rememberScroll();
  },true);
  window.addEventListener('hashchange',()=>{
    const target=mediaTarget(location.hash);if(target)revealMedia(target);
    if(!restoring){identifyEntry();requestAnimationFrame(rememberScroll);}
  });
})();
