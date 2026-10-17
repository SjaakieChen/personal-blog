(() => {
  const ready=document.fonts?.ready || Promise.resolve();
  ready.then(()=>document.querySelectorAll('[data-post-preview]').forEach(body=>{
    const button=body.nextElementSibling;
    let expanded=false;
    function expand() {
      expanded=true;body.classList.remove('post-collapsed');button.setAttribute('aria-expanded','true');button.textContent='Show less';
      body.querySelectorAll('[data-preview-tabindex]').forEach(a=>{const previous=a.dataset.previewTabindex; if(previous==='none')a.removeAttribute('tabindex');else a.setAttribute('tabindex',previous);delete a.dataset.previewTabindex;});
    }
    function collapse() {
      expanded=false;body.classList.add('post-collapsed');button.setAttribute('aria-expanded','false');button.textContent='Show more';
      const bottom=body.getBoundingClientRect().top+body.clientHeight;
      body.querySelectorAll('a').forEach(a=>{if(a.getBoundingClientRect().bottom>bottom){a.dataset.previewTabindex=a.getAttribute('tabindex') ?? 'none';a.tabIndex=-1;}});
    }
    function measure() {if(expanded)return;body.classList.remove('post-collapsed');const long=body.scrollHeight>620;button.hidden=!long;if(long)collapse();}
    button.addEventListener('click',()=>{if(expanded){collapse();body.closest('article').scrollIntoView({block:'start'});}else expand();});
    // Reveal any destination hidden in this preview before the browser jumps to it.
    document.addEventListener('click',e=>{
      const a=e.target.closest('a');
      if(!a?.hash || !window.BlogLinks?.samePage(a))return;
      let id;try{id=decodeURIComponent(a.hash.slice(1));}catch{return;}
      if(body.contains(document.getElementById(id)))expand();
    });
    function revealHash(){if(location.hash && Array.from(body.querySelectorAll('[id]')).some(el=>'#'+el.id===location.hash))expand();}
    measure();revealHash();window.addEventListener('hashchange',revealHash);
    let width=body.clientWidth;new ResizeObserver(()=>{if(body.clientWidth!==width){width=body.clientWidth;expand();expanded=false;measure();}}).observe(body);
  }));
})();
