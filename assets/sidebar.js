(() => {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.getElementById('site-sidebar');
  if (!toggle || !sidebar) return;

  function setOpen(open) {
    sidebar.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setOpen(sidebar.hidden));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || sidebar.hidden || document.querySelector('dialog[open]')) return;
    setOpen(false);
    toggle.focus({preventScroll: true});
  });
  sidebar.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || !event.target.closest('a[href]')) return;
    setOpen(false);
    document.getElementById('posts')?.focus({preventScroll: true});
  });
  // An open menu is deliberately not saved between visits or page loads.
  setOpen(false);
})();
