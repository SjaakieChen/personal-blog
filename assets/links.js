(() => {
  // Keep already-published citation markers compact without changing their targets.
  document.querySelectorAll('.citation a').forEach(link=>{
    const match=link.textContent.match(/^\[(\d+)(?:,\s*([\s\S]*))?\]$/);
    if(match){if(match[2] && !link.title)link.title=match[2];link.textContent='['+match[1]+']';}
  });
  // Also applies to links in posts published before the editor added these attributes.
  document.querySelectorAll('a[href]:not(.skip-link)').forEach(link=>{
    if(link.closest('.explanation-marker') && link.getAttribute('href').startsWith('#')){
      link.removeAttribute('target');link.removeAttribute('rel');
    }else{link.target='_blank';link.rel='noopener noreferrer';}
  });
})();
