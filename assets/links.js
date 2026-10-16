(() => {
  // Also applies to links in posts published before the editor added these attributes.
  document.querySelectorAll('a[href]:not(.skip-link)').forEach(link=>{
    link.target='_blank';link.rel='noopener noreferrer';
  });
})();
