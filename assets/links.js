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
  window.BlogLinks={samePage};
  scan(document);
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')update(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link)update(link);},true);
})();
