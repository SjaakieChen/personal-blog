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
    button.addEventListener('click',()=>{
      if(!expanded){expand();return;}
      const article=body.closest('article'),scroller=body.closest('.main') || document.scrollingElement;
      const next=article.nextElementSibling,view=scroller.getBoundingClientRect(),nextTop=next?.getBoundingClientRect().top;
      // Keep the next post in place when it is already visible. Otherwise keep
      // the toggle in place, including when mobile media sits below the text.
      const anchor=next && nextTop>=view.top && nextTop<view.bottom ? next : button;
      const top=anchor.getBoundingClientRect().top;
      collapse();
      const pane=article.querySelector(':scope > .post-media');
      if(pane)window.BlogEvidenceMedia?.alignPane(body,pane);
      // Read after layout so native scroll anchoring is already reflected;
      // compensate only for the remaining movement, within the scroll limits.
      scroller.scrollTop+=anchor.getBoundingClientRect().top-top;
    });
    // Reveal any destination hidden in this preview before the browser jumps to it.
    document.addEventListener('click',e=>{
      const a=e.target.closest('a');
      if(!a?.hash || !window.BlogLinks?.samePage(a))return;
      let id;try{id=decodeURIComponent(a.hash.slice(1));}catch{return;}
      if(body.contains(document.getElementById(id)))expand();
    });
    function revealHash(){if(location.hash && Array.from(body.querySelectorAll('[id]')).some(el=>'#'+el.id===location.hash))expand();}
    measure();revealHash();window.addEventListener('hashchange',revealHash);
    let width=body.clientWidth;new ResizeObserver(()=>{
      if(body.clientWidth!==width){
        width=body.clientWidth;
        // A resize must not fold an article the reader chose to open.
        if(!expanded){expand();expanded=false;measure();}
      }
    }).observe(body);
  }));
})();
