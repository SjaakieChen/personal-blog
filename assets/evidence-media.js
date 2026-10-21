(function (root) {
  'use strict';

  function youtubeId(value) {
    if (typeof value !== 'string') return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
        && url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
      id = url.searchParams.get('v');
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  }

  function pdfManifest(data, assetBase) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const path = /^\/assets\/evidence\/[A-Za-z0-9_/-]+\.(pdf|webp|png|jpe?g)$/;
    return Object.values(data).flatMap(entry => {
      if (!entry || typeof entry.title !== 'string' || !path.test(entry.pdf || '')
          || !entry.pdf.endsWith('.pdf') || !Array.isArray(entry.previews) || !entry.previews.length
          || !entry.previews.every(preview => typeof preview === 'string' && path.test(preview) && !preview.endsWith('.pdf'))) return [];
      const pages = entry.preview_pages ?? entry.previews.map((_, index) => index + 1);
      const totalPages = entry.total_pages ?? (entry.preview_pages ? null : entry.previews.length);
      if (!Array.isArray(pages) || pages.length !== entry.previews.length
          || !pages.every(page => Number.isSafeInteger(page) && page > 0)
          || (totalPages !== null && (!Number.isSafeInteger(totalPages) || totalPages < Math.max(...pages)))) return [];
      try {
        const download = entry.download_url || entry.public_pdf;
        if (typeof download !== 'string' || !download.trim()) return [];
        const downloadURL = new URL(download, assetBase), baseURL = new URL(assetBase);
        const sameOriginHTTP = downloadURL.protocol === 'http:' && downloadURL.origin === baseURL.origin;
        if ((downloadURL.protocol !== 'https:' && !sameOriginHTTP) || downloadURL.username || downloadURL.password) return [];
        return [{type: 'pdf', key: 'pdf:' + entry.pdf, title: entry.title, downloadURL, pages, totalPages,
          localURL: new URL(entry.pdf.slice(1), assetBase),
          previews: entry.previews.map(preview => new URL(preview.slice(1), assetBase).href)}];
      } catch { return []; }
    });
  }

  function knownPdf(value, entries, base) {
    let url;
    try { url = new URL(value, base); } catch { return null; }
    if (url.username || url.password) return null;
    return entries.find(entry => [entry.downloadURL, entry.localURL].some(known =>
      url.origin === known.origin && url.pathname === known.pathname)) || null;
  }

  function mediaIn(body, entries = []) {
    const media = new Map();
    for (const link of body.querySelectorAll('a[href]')) {
      if (link.closest('.references, [data-references], .explanation-notes, [data-notes]')) continue;
      const value = link.getAttribute('href'), id = youtubeId(value);
      const item = id ? {type: 'video', key: 'video:' + id, id, title: link.textContent.trim() || 'YouTube video'}
        : knownPdf(value, entries, body.ownerDocument.baseURI);
      if (item && !media.has(item.key)) media.set(item.key, item);
    }
    return [...media.values()];
  }

  function createMedia(doc, item) {
    const block = doc.createElement(item.type === 'video' ? 'figure' : 'div');
    block.dataset.mediaKey = item.key;
    if (item.type === 'video') {
      block.className = 'evidence-video';
      const frame = doc.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + item.id;
      frame.title = item.title;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      const caption = doc.createElement('figcaption');
      caption.textContent = item.title;
      block.append(frame, caption);
    } else {
      block.className = 'evidence-pdf';
      item.previews.forEach((src, index) => {
        const figure = doc.createElement('figure'), link = doc.createElement('a');
        link.href = item.downloadURL.href;
        link.setAttribute('aria-label', 'Open original PDF');
        const image = doc.createElement('img');
        image.src = src;
        image.alt = item.title + ', page ' + item.pages[index] + (item.totalPages ? ' of ' + item.totalPages : '');
        image.loading = 'lazy';
        const caption = doc.createElement('figcaption');
        caption.textContent = item.title + ' · ' + item.pages[index] + (item.totalPages ? ' / ' + item.totalPages : '');
        link.append(image);figure.append(link, caption);block.append(figure);
      });
    }
    return block;
  }

  function renderPane(body, pane, entries = []) {
    const available = [...pane.children];
    const blocks = available.filter(block => block.hasAttribute('data-static-media'));
    for (const item of mediaIn(body, entries)) {
      if (blocks.some(block => block.dataset.mediaKey === item.key)) continue;
      const block = available.find(block => block.dataset.mediaKey === item.key) || createMedia(body.ownerDocument, item);
      if (item.type === 'video') {
        block.querySelector('iframe').title = item.title;
        block.querySelector('figcaption').textContent = item.title;
      }
      blocks.push(block);
    }
    // Preserve live frames across editor redraws and text edits. Neither the
    // editable HTML nor the serialized document gains media nodes.
    available.filter(block => !blocks.includes(block)).forEach(block => block.remove());
    blocks.forEach((block, index) => {
      if (pane.children[index] !== block) pane.insertBefore(block, pane.children[index] || null);
    });
    pane.hidden = !blocks.length;
  }

  function moveInlineMedia(body, pane) {
    // Existing article images/video belong beside the text too. The writer
    // never calls this: source documents and editable content remain intact.
    for (const element of body.querySelectorAll('img, video, audio, object[type="application/pdf"]')) {
      if (!body.contains(element) || element.closest('.references, .explanation-notes')) continue;
      const originalParent = element.parentElement;
      const figure = element.closest('figure');
      const content = figure && body.contains(figure) ? figure
        : originalParent?.tagName === 'A' ? originalParent : element;
      const block = body.ownerDocument.createElement('div');
      block.className = 'evidence-image';
      block.dataset.staticMedia = '';
      block.dataset.mediaKey = 'inline:' + pane.children.length;
      block.append(content);pane.append(block);
      if (originalParent?.tagName === 'P' && !originalParent.textContent.trim() && !originalParent.children.length) originalParent.remove();
    }
  }

  function enhanceArticle(body, entries = []) {
    const pane = body.closest('.post')?.querySelector(':scope > .post-media');
    if (!pane) return;
    moveInlineMedia(body, pane);
    renderPane(body, pane, entries);
  }

  function watchPreview(body, pane, getEntries = () => []) {
    const render = () => renderPane(body, pane, getEntries());
    render();
    const observer = new root.MutationObserver(render);
    observer.observe(body, {childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['href']});
    return {observer, render};
  }

  const api = {youtubeId, pdfManifest, knownPdf, mediaIn, renderPane, enhanceArticle, watchPreview};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) {
    root.BlogEvidenceMedia = api;
    let entries = [];
    const body = root.document.getElementById('body');
    const pane = root.document.getElementById('evidence-media-preview');
    const preview = body && pane ? watchPreview(body, pane, () => entries) : null;
    const refresh = () => preview ? preview.render()
      : root.document.querySelectorAll('.post-body').forEach(body => enhanceArticle(body, entries));
    refresh();
    const source = root.document.currentScript?.src;
    if (source) {
      const assetBase = new URL('../', source);
      root.fetch(new URL('assets/evidence/media.json', assetBase)).then(response => {
        if (!response.ok) throw new Error('Media manifest unavailable');
        return response.json();
      }).then(data => { entries = pdfManifest(data, assetBase);refresh(); }).catch(() => {
        // Text links, video embeds and server-rendered PDF previews remain usable.
      });
    }
  }
})(typeof window === 'object' ? window : globalThis);
