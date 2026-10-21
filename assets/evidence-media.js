(function (root) {
  'use strict';
  const scriptSource = root.document?.currentScript?.src;
  const siteBase = scriptSource ? new URL('../', scriptSource).href : null;
  const demoCleanup = new WeakMap();

  function demoURL(value, base, assetBase) {
    if (typeof value !== 'string' || /[\\\s<>]/.test(value)) return null;
    try {
      const current = new URL(base), url = new URL(value, current);
      const assets = new URL('assets/evidence/', assetBase || new URL('/', current));
      const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname);
      if ((url.protocol !== 'https:' && !localHTTP) || url.origin !== current.origin
          || assets.origin !== current.origin || url.username || url.password || !url.pathname.startsWith(assets.pathname)) return null;
      if (!/^(?:drafts\/)?demos\/[A-Za-z0-9_-]+\/index\.html$/.test(url.pathname.slice(assets.pathname.length))) return null;
      url.search = '';url.hash = '';
      return url.href;
    } catch { return null; }
  }

  function imageURL(value, base, assetBase) {
    if (typeof value !== 'string' || /[\\\s<>]/.test(value)) return null;
    try {
      const current = new URL(base);
      let url = new URL(value, current);
      const assets = new URL('assets/evidence/', assetBase || new URL('/', current));
      const filename = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:webp|png|jpe?g)$/;
      const publicAssets = 'https://sjaakiechen.github.io/personal-blog/assets/evidence/';
      if (value.startsWith(publicAssets)) {
        const relative = value.slice(publicAssets.length).split(/[?#]/, 1)[0];
        if (!filename.test(relative)) return null;
        // The private desk serves this blog's deployed assets locally. Keep the
        // public href in the document; map only the generated image preview.
        url = new URL(relative, assets);
      }
      const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname);
      if ((url.protocol !== 'https:' && !localHTTP) || url.origin !== current.origin
          || assets.origin !== current.origin || url.username || url.password || !url.pathname.startsWith(assets.pathname)) return null;
      const relative = url.pathname.slice(assets.pathname.length);
      if (!filename.test(relative)) return null;
      url.search = '';url.hash = '';
      return url.href;
    } catch { return null; }
  }

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
      const image = imageURL(value, body.ownerDocument.baseURI, siteBase);
      const demo = demoURL(value, body.ownerDocument.baseURI, siteBase);
      const item = id ? {type: 'video', key: 'video:' + id, id, title: link.textContent.trim() || 'YouTube video'}
        : image ? {type: 'image', key: 'image:' + image, url: image, title: link.textContent.trim() || 'Project screenshot'}
        : demo ? {type: 'demo', key: 'demo:' + demo, url: demo, title: link.textContent.trim() || 'Interactive emulator'}
        : knownPdf(value, entries, body.ownerDocument.baseURI);
      if (item && !media.has(item.key)) media.set(item.key, item);
    }
    return [...media.values()];
  }

  function createDemo(doc, block, item) {
    block.className = 'evidence-demo';block.dataset.state = 'idle';
    const view = doc.defaultView, stage = doc.createElement('div'), controls = doc.createElement('div');
    const load = doc.createElement('button'), unload = doc.createElement('button'), fullscreen = doc.createElement('button');
    const open = doc.createElement('a'), status = doc.createElement('p'), caption = doc.createElement('figcaption');
    stage.className = 'evidence-demo-stage';controls.className = 'evidence-demo-controls';
    for (const button of [load, unload, fullscreen]) button.type = 'button';
    load.textContent = 'Load emulator';unload.textContent = 'Unload';fullscreen.textContent = 'Fullscreen';
    unload.hidden = true;fullscreen.hidden = true;
    open.textContent = 'Open emulator';open.href = item.url;open.target = '_blank';open.rel = 'noopener noreferrer';
    status.className = 'evidence-demo-status';status.setAttribute('role', 'status');
    status.textContent = 'Loads only when you choose to open it.';caption.textContent = item.title;
    controls.append(load, unload, fullscreen, open);block.append(stage, controls, status, caption);
    block.addEventListener('fullscreenchange', () => {
      fullscreen.textContent = doc.fullscreenElement === block ? 'Exit fullscreen' : 'Fullscreen';
    });
    function stop() {
      if (doc.fullscreenElement === block) doc.exitFullscreen().catch(() => {});
      demoCleanup.get(block)?.();demoCleanup.delete(block);stage.replaceChildren();
      unload.hidden = true;fullscreen.hidden = true;load.hidden = false;load.disabled = false;
    }
    unload.addEventListener('click', () => {
      stop();block.dataset.state = 'idle';load.textContent = 'Load emulator';
      status.textContent = 'Emulator unloaded.';
    });
    fullscreen.addEventListener('click', async () => {
      try {
        if (doc.fullscreenElement === block) await doc.exitFullscreen();
        else await block.requestFullscreen();
      }
      catch { status.textContent = 'Fullscreen is unavailable. Use Open emulator for a separate tab.'; }
    });
    load.addEventListener('click', () => {
      stop();block.dataset.state = 'loading';load.disabled = true;load.textContent = 'Loading…';
      unload.hidden = false;status.textContent = 'Loading emulator…';
      const frame = doc.createElement('iframe');
      frame.title = caption.textContent;frame.setAttribute('sandbox', 'allow-scripts');
      frame.referrerPolicy = 'no-referrer';frame.allow = 'fullscreen';frame.allowFullscreen = true;
      let timer;
      const fail = () => {
        stop();block.dataset.state = 'error';load.textContent = 'Retry';
        status.textContent = 'Emulator could not load. Retry or open it in a separate tab.';
      };
      const receive = event => {
        if (event.source !== frame.contentWindow) return;
        if (event.data?.type === 'blog-demo-ready') {
          view.clearTimeout(timer);block.dataset.state = 'ready';load.hidden = true;fullscreen.hidden = false;
          status.textContent = 'Emulator ready.';
        } else if (event.data?.type === 'blog-demo-error') fail();
      };
      view.addEventListener('message', receive);frame.addEventListener('error', fail);
      timer = view.setTimeout(fail, 20000);
      demoCleanup.set(block, () => {
        view.clearTimeout(timer);view.removeEventListener('message', receive);frame.removeEventListener('error', fail);
      });
      // The entry document and all of its scripts start loading only here.
      frame.src = item.url;stage.append(frame);
    });
  }

  function createMedia(doc, item) {
    const block = doc.createElement(item.type === 'pdf' ? 'div' : 'figure');
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
    } else if (item.type === 'demo') {
      createDemo(doc, block, item);
    } else if (item.type === 'image') {
      block.className = 'evidence-image';
      const link = doc.createElement('a'), image = doc.createElement('img'), caption = doc.createElement('figcaption');
      link.href = item.url;link.target = '_blank';link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', 'Open full-size image: ' + item.title);
      image.src = item.url;image.alt = item.title;image.loading = 'lazy';
      caption.textContent = item.title;
      link.append(image);block.append(link, caption);
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
      } else if (item.type === 'image') {
        block.querySelector('img').alt = item.title;
        block.querySelector('a').setAttribute('aria-label', 'Open full-size image: ' + item.title);
        block.querySelector('figcaption').textContent = item.title;
      } else if (item.type === 'demo') {
        block.querySelector('figcaption').textContent = item.title;
        const frame = block.querySelector('iframe');
        if (frame) frame.title = item.title;
      }
      blocks.push(block);
    }
    // Preserve live frames across editor redraws and text edits. Neither the
    // editable HTML nor the serialized document gains media nodes.
    available.filter(block => !blocks.includes(block)).forEach(block => {
      demoCleanup.get(block)?.();demoCleanup.delete(block);block.remove();
    });
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

  const api = {youtubeId, imageURL, demoURL, pdfManifest, knownPdf, mediaIn, renderPane, enhanceArticle, watchPreview};
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
