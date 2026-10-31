(function (root) {
  'use strict';

  function modalRequest(href) {
    let url, id;
    try {
      url = new URL(href);
      const modes = url.searchParams.getAll('media');
      if (modes.length !== 1 || modes[0] !== 'modal'
          || !/\/archive\/[^/]+\/?$/.test(url.pathname)
          || !url.hash.startsWith('#media-')) return null;
      id = decodeURIComponent(url.hash.slice(1));
    } catch { return null; }
    return id.startsWith('media-') && !/[\u0000-\u001f\u007f]/.test(id)
      ? {href: url.href, id, hash: url.hash} : null;
  }

  function withoutModal(href) {
    const url = new URL(href);
    url.searchParams.delete('media');
    return url.href;
  }

  function outsideDialog(event, rect) {
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  function mediaKind(block) {
    if (block.classList.contains('evidence-pdf')) return 'pdf';
    if (block.classList.contains('evidence-demo')) return 'demo';
    if (block.classList.contains('evidence-video')) return 'video';
    if (block.classList.contains('evidence-image')) return 'image';
    return null;
  }

  function targetFor(doc, request) {
    const target = doc.getElementById(request.id);
    const block = target?.closest('[data-media-key]');
    if (!block?.parentElement?.classList.contains('post-media') || !mediaKind(block)) return null;
    // A PDF carousel is built after the asynchronous media manifest arrives.
    // Wait for that rather than moving its slides before they are enhanced.
    if (mediaKind(block) === 'pdf' && block.querySelectorAll(':scope > figure').length > 1
        && !block.classList.contains('evidence-pdf-carousel')) return null;
    return {target, block};
  }

  function focusAfterClose(block, previous, body) {
    const usable = element => element?.isConnected && element !== body && !element.disabled
      && !element.closest('[inert], [hidden], [aria-hidden="true"]') && element.getClientRects().length > 0;
    if (usable(previous)) return previous;
    // A PDF can open at page 3 while the first anchor belongs to inert page 1.
    // Prefer the currently selected slide, then a visible enabled control.
    const selector = 'a[href], button:not([disabled]), video[controls], iframe';
    const current = block.querySelector('.is-current');
    const candidates = [...(current?.querySelectorAll(selector) || []), ...block.querySelectorAll(selector)];
    return candidates.find(usable) || null;
  }

  function install(view) {
    const doc = view.document;
    if (typeof view.HTMLDialogElement !== 'function') return;
    let active = null, lastURL = view.location.href, consumedURL = '', scheduled = false;

    function move(parent, child, before = null) {
      // Atomic moves keep a connected iframe's document and simulation alive.
      if (typeof parent.moveBefore === 'function' && child.isConnected && parent.isConnected) {
        parent.moveBefore(child, before);
      } else parent.insertBefore(child, before);
    }

    function stopPlayback(content) {
      for (const video of content.querySelectorAll('video, audio')) video.pause();
      for (const frame of content.querySelectorAll('iframe')) {
        let url;
        try { url = new URL(frame.src); } catch { continue; }
        if (['www.youtube-nocookie.com', 'www.youtube.com'].includes(url.hostname)
            && url.pathname.startsWith('/embed/')) {
          // The existing embeds do not enable the YouTube JS API. Reloading
          // their same, non-autoplay URL reliably stops audio when dismissed.
          frame.src = url.href;
        }
      }
    }

    function close(record = active, clearQuery = true, returnFocus = true) {
      if (!record || record.closed) return;
      record.closed = true;
      stopPlayback(record.content);
      if (record.dialog.open) record.dialog.close();
      for (const child of [...record.content.childNodes]) move(record.block, child, record.dialog);
      record.dialog.remove();
      record.block.style.minHeight = record.minHeight;
      record.block.classList.remove('archive-media-modal-host');
      if (active === record) active = null;
      if (clearQuery && modalRequest(view.location.href)) {
        view.history.replaceState(view.history.state, '', withoutModal(view.location.href));
      }
      lastURL = view.location.href;
      if (returnFocus) {
        focusAfterClose(record.block, record.focus, doc.body)?.focus({preventScroll: true});
      }
      doc.dispatchEvent(new view.CustomEvent('blog-media-layout'));
    }

    function open(request, target, block) {
      const kind = mediaKind(block), rect = block.getBoundingClientRect();
      const dialog = doc.createElement('dialog'), header = doc.createElement('div');
      const title = doc.createElement('p'), dismiss = doc.createElement('button');
      const content = doc.createElement('div');
      const children = [...block.childNodes];
      dialog.className = 'archive-media-modal';
      dialog.setAttribute('aria-label', 'Enlarged media');
      header.className = 'archive-media-modal-header';
      title.className = 'archive-media-modal-title';
      title.textContent = block.getAttribute('aria-label') || block.dataset.demoTitle
        || block.querySelector('figcaption')?.textContent.trim() || 'Media';
      dismiss.type = 'button';dismiss.textContent = 'Close';
      dismiss.className = 'archive-media-modal-close';
      dismiss.setAttribute('aria-label', 'Close enlarged media');
      content.className = 'archive-media-modal-content archive-media-modal-content--' + kind;
      header.append(title);
      if (kind === 'image') {
        const navigation = doc.createElement('div'), previous = doc.createElement('button');
        const next = doc.createElement('button'), position = doc.createElement('span');
        const images = [...block.parentElement.children].filter(item =>
          mediaKind(item) === 'image' && item.id.startsWith('media-image/') && item.querySelector('img'));
        const index = images.indexOf(block);
        navigation.className = 'archive-media-modal-image-navigation';
        previous.type = next.type = 'button';
        previous.textContent = 'Previous';next.textContent = 'Next';
        previous.setAttribute('aria-label', 'Previous image');next.setAttribute('aria-label', 'Next image');
        previous.disabled = index <= 0;next.disabled = index < 0 || index === images.length - 1;
        position.textContent = (index + 1) + ' / ' + images.length;
        position.setAttribute('aria-label', 'Image ' + (index + 1) + ' of ' + images.length);
        const navigate = step => {
          const destination = images[index + step];
          if (destination?.isConnected) view.location.hash = destination.id;
        };
        previous.addEventListener('click', () => navigate(-1));
        next.addEventListener('click', () => navigate(1));
        navigation.append(previous, position, next);header.append(navigation);
      }
      header.append(dismiss);dialog.append(header, content);
      const record = {dialog, content, block, focus: doc.activeElement,
        minHeight: block.style.minHeight, closed: false, request};
      active = record;consumedURL = request.href;
      // Dispatch while the existing carousel is intact so its own controller
      // selects the requested page (including page 3) before it is enlarged.
      target.dispatchEvent(new view.CustomEvent('blog-media-reveal', {bubbles: true, detail: {target}}));
      target.scrollIntoView({block: 'start'});
      block.style.minHeight = Math.max(0, rect.height) + 'px';
      block.classList.add('archive-media-modal-host');
      block.append(dialog);
      for (const child of children) move(content, child);
      dismiss.addEventListener('click', () => close(record));
      dialog.addEventListener('cancel', event => {event.preventDefault();close(record);});
      dialog.addEventListener('close', () => close(record));
      let backdropPress = false;
      dialog.addEventListener('pointerdown', event => {
        backdropPress = event.target === dialog && outsideDialog(event, dialog.getBoundingClientRect());
      });
      dialog.addEventListener('click', event => {
        if (backdropPress && event.target === dialog && outsideDialog(event, dialog.getBoundingClientRect())) close(record);
        backdropPress = false;
      });
      try {
        dialog.showModal();dismiss.focus({preventScroll: true});
      } catch {
        // Preserve the normal embedded media if this browser cannot show it.
        close(record, true, false);
      }
    }

    function sync() {
      scheduled = false;
      const href = view.location.href;
      if (href !== lastURL) {
        consumedURL = '';lastURL = href;
        if (active) close(active, false, false);
      }
      const request = modalRequest(href);
      if (!request) {if (active) close(active, false, false);return;}
      if (active || consumedURL === request.href) return;
      const found = targetFor(doc, request);
      if (found) open(request, found.target, found.block);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;view.requestAnimationFrame(sync);
    }
    for (const event of ['hashchange', 'popstate']) view.addEventListener(event, schedule);
    for (const event of ['blog-media-layout', 'blog-media-reveal', 'DOMContentLoaded']) doc.addEventListener(event, schedule);
    doc.addEventListener('load', schedule, true);
    schedule();
    return {close: () => close(), sync};
  }

  const api = {modalRequest, withoutModal, outsideDialog, mediaKind, targetFor, focusAfterClose, install};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) install(root);
})(typeof window === 'object' ? window : globalThis);
