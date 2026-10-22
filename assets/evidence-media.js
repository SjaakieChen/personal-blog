(function (root) {
  'use strict';
  const scriptSource = root.document?.currentScript?.src;
  const siteBase = scriptSource ? new URL('../', scriptSource).href : null;
  const demoCleanup = new WeakMap();
  const demoStart = new WeakMap();
  const mediaAnchors = new WeakMap();
  const paneLayouts = new WeakMap();

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
      const fragmentPrefix = '#media-image/assets/evidence/';
      if (value.startsWith(fragmentPrefix)) {
        const relative = value.slice(fragmentPrefix.length);
        if (!filename.test(relative)) return null;
        url = new URL(relative, assets);
      } else if (value.startsWith(publicAssets)) {
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

  function imageFragment(value, base, assetBase) {
    const image = imageURL(value, base, assetBase);
    if (!image) return null;
    const assets = new URL('assets/evidence/', assetBase || new URL('/', base));
    return '#media-image/assets/evidence/' + new URL(image).pathname.slice(assets.pathname.length);
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
    return Object.entries(data).flatMap(([permalink, entry]) => {
      if (!/^\/(?:[^/?#]+(?:\/[^/?#]+)*\/?)?$/.test(permalink)) return [];
      if (!entry || typeof entry.title !== 'string' || !path.test(entry.pdf || '')
          || !entry.pdf.endsWith('.pdf') || !Array.isArray(entry.previews) || !entry.previews.length
          || !entry.previews.every(preview => typeof preview === 'string' && path.test(preview) && !preview.endsWith('.pdf'))) return [];
      const pages = entry.preview_pages ?? entry.previews.map((_, index) => index + 1);
      const totalPages = entry.total_pages ?? (entry.preview_pages ? null : entry.previews.length);
      if (!Array.isArray(pages) || pages.length !== entry.previews.length
          || !pages.every(page => Number.isSafeInteger(page) && page > 0)
          || new Set(pages).size !== pages.length
          || (totalPages !== null && (!Number.isSafeInteger(totalPages) || totalPages < Math.max(...pages)))) return [];
      // Double hyphens separate route segments. Escape ambiguous hyphens and
      // punctuation so distinct permalinks retain distinct, stable media IDs.
      const route = permalink.slice(1).replace(/\/$/, '').split('/').map(segment =>
        segment.replace(/^-|-$|--|[^A-Za-z0-9-]/g, value =>
          Array.from(value, character => '_' + character.codePointAt(0).toString(16) + '_').join(''))).join('--');
      const id = 'media' + (route ? '-' + route : '');
      try {
        const download = entry.download_url || entry.public_pdf;
        if (typeof download !== 'string' || !download.trim()) return [];
        const downloadURL = new URL(download, assetBase), baseURL = new URL(assetBase);
        const sameOriginHTTP = downloadURL.protocol === 'http:' && downloadURL.origin === baseURL.origin;
        if ((downloadURL.protocol !== 'https:' && !sameOriginHTTP) || downloadURL.username || downloadURL.password) return [];
        return [{type: 'pdf', key: 'pdf:' + entry.pdf, id, title: entry.title, downloadURL, pages, totalPages,
          localURL: new URL(entry.pdf.slice(1), assetBase),
          previews: entry.previews.map(preview => new URL(preview.slice(1), assetBase).href)}];
      } catch { return []; }
    });
  }

  function knownPdf(value, entries, base) {
    if (typeof value === 'string' && value.startsWith('#')) {
      let target;
      try { target = decodeURIComponent(value.slice(1)); } catch { return null; }
      return entries.find(entry => target === entry.id + '-document'
        || entry.pages.some(page => target === entry.id + '-page-' + page)) || null;
    }
    let url;
    try { url = new URL(value, base); } catch { return null; }
    if (url.username || url.password) return null;
    return entries.find(entry => [entry.downloadURL, entry.localURL].some(known =>
      url.origin === known.origin && url.pathname === known.pathname)) || null;
  }

  function mediaIn(body, entries = []) {
    const media = new Map();
    const scope = body.closest('.post-copy') || body.closest('.post') || body;
    for (const link of body.querySelectorAll('a[href]')) {
      if (link.closest('.references, [data-references], .explanation-notes, [data-notes]')) continue;
      let source = link;
      const href = link.getAttribute('href');
      if (href.startsWith('#') && !knownPdf(href, entries, body.ownerDocument.baseURI)
          && !imageURL(href, body.ownerDocument.baseURI, siteBase)
          && link.closest('.citation, [data-reference]')) {
        // Resolve a numbered citation only within this post's own References.
        // The citation stays the anchor; the source supplies its URL and title.
        let target;
        try { target = decodeURIComponent(href.slice(1)); } catch { continue; }
        const reference = [...scope.querySelectorAll('.references li[id], [data-references] li[id]')]
          .find(item => item.id === target);
        source = reference?.querySelector(':scope > a[href]');
        if (!source) continue;
      }
      const value = source.getAttribute('href'), id = youtubeId(value);
      const image = imageURL(value, body.ownerDocument.baseURI, siteBase);
      const demo = demoURL(value, body.ownerDocument.baseURI, siteBase);
      const loadModes = demo ? new URL(value, body.ownerDocument.baseURI).searchParams.getAll('load') : [];
      const autoLoad = loadModes.length === 1 && loadModes[0] === 'auto';
      const item = id ? {type: 'video', key: 'video:' + id, id, title: source.textContent.trim() || 'YouTube video'}
        : image ? {type: 'image', key: 'image:' + image, url: image, title: source.textContent.trim() || 'Project screenshot'}
        : demo ? {type: 'demo', key: 'demo:' + (autoLoad ? 'auto:' : '') + demo, url: demo, autoLoad,
          title: source.textContent.trim() || (autoLoad ? 'Interactive demo' : 'Interactive emulator')}
        : knownPdf(value, entries, body.ownerDocument.baseURI);
      if (!item) continue;
      // One frame per canonical demo URL, including mixed manual/auto links.
      // Any explicit auto link opts it in; keep the first mention's placement.
      const key = item.type === 'demo' ? 'demo:' + item.url : item.key;
      const existing = media.get(key);
      if (!existing) media.set(key, {...item, anchor: link});
      else if (item.type === 'demo' && item.autoLoad && !existing.autoLoad) {
        media.set(key, {...existing, autoLoad: true, key: item.key});
      }
    }
    return [...media.values()];
  }

  function imageTarget(link) {
    const body = link.closest('.post-body');
    if (!body || link.closest('.references, [data-references], .explanation-notes, [data-notes]')) return null;
    const url = imageURL(link.getAttribute('href'), link.ownerDocument.baseURI, siteBase);
    const pane = body.closest('.post')?.querySelector(':scope > .post-media');
    if (!url || !pane || pane.hidden) return null;
    return [...pane.children].find(block => !block.hidden && block.classList.contains('evidence-image')
      && block.dataset.mediaKey === 'image:' + url) || null;
  }

  function createDemo(doc, block, item) {
    block.className = 'evidence-demo';block.dataset.state = 'idle';
    const autoLoad = item.autoLoad === true;
    block.dataset.loadMode = autoLoad ? 'auto' : 'manual';
    const view = doc.defaultView, stage = doc.createElement('div'), controls = doc.createElement('div');
    const load = doc.createElement('button'), unload = doc.createElement('button'), fullscreen = doc.createElement('button');
    const open = doc.createElement('a'), status = doc.createElement('p'), caption = doc.createElement('figcaption');
    stage.className = 'evidence-demo-stage';controls.className = 'evidence-demo-controls';
    for (const button of [load, unload, fullscreen]) button.type = 'button';
    load.textContent = 'Load emulator';unload.textContent = 'Unload';fullscreen.textContent = 'Fullscreen';
    load.hidden = autoLoad;unload.hidden = true;fullscreen.hidden = true;
    open.textContent = autoLoad ? 'Open demo' : 'Open emulator';open.href = item.url;open.target = '_blank';open.rel = 'noopener noreferrer';
    status.className = 'evidence-demo-status';status.setAttribute('role', 'status');
    status.textContent = autoLoad ? 'Loading demo…' : 'Loads only when you choose to open it.';caption.textContent = item.title;
    controls.hidden = open.hidden = status.hidden = caption.hidden = autoLoad;
    controls.append(load, unload, fullscreen, open);block.append(stage, controls, status, caption);
    block.addEventListener('fullscreenchange', () => {
      fullscreen.textContent = doc.fullscreenElement === block ? 'Exit fullscreen' : 'Fullscreen';
    });
    function stop() {
      if (doc.fullscreenElement === block) doc.exitFullscreen().catch(() => {});
      demoCleanup.get(block)?.();demoCleanup.delete(block);stage.replaceChildren();
      unload.hidden = true;fullscreen.hidden = true;load.hidden = autoLoad;load.disabled = false;
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
      catch {
        status.hidden = false;
        status.textContent = 'Fullscreen is unavailable. Use ' + (autoLoad ? 'Open demo' : 'Open emulator') + ' for a separate tab.';
      }
    });
    function start() {
      stop();block.dataset.state = 'loading';load.disabled = true;load.textContent = 'Loading…';
      unload.hidden = controls.hidden = status.hidden = autoLoad;status.textContent = autoLoad ? '' : 'Loading emulator…';
      const frame = doc.createElement('iframe');
      frame.title = caption.textContent;frame.setAttribute('sandbox', 'allow-scripts');
      frame.referrerPolicy = 'no-referrer';frame.allow = 'fullscreen';frame.allowFullscreen = true;
      let timer;
      const fail = () => {
        stop();block.dataset.state = 'error';load.hidden = false;load.textContent = 'Retry';status.hidden = false;
        controls.hidden = false;
        status.textContent = autoLoad ? 'Demo could not load. Retry.' : 'Emulator could not load. Retry or open it in a separate tab.';
      };
      const receive = event => {
        if (event.source !== frame.contentWindow) return;
        if (event.data?.type === 'blog-demo-ready') {
          view.clearTimeout(timer);block.dataset.state = 'ready';load.hidden = true;fullscreen.hidden = autoLoad;
          status.hidden = autoLoad;status.textContent = autoLoad ? '' : 'Emulator ready.';
        } else if (event.data?.type === 'blog-demo-error') fail();
      };
      view.addEventListener('message', receive);frame.addEventListener('error', fail);
      timer = view.setTimeout(fail, 20000);
      demoCleanup.set(block, () => {
        view.clearTimeout(timer);view.removeEventListener('message', receive);frame.removeEventListener('error', fail);
      });
      // Use the validated canonical URL; load=auto only controls this wrapper.
      frame.src = item.url;stage.append(frame);
    }
    load.addEventListener('click', start);
    if (autoLoad) demoStart.set(block, start);
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

  function enhancePdf(block, item) {
    // A full poster is one document to browse. Keep representative excerpts
    // (such as pages 1, 10 and 16 of an essay) visible together as before.
    if (block.classList.contains('evidence-pdf-carousel') || item.previews.length < 2
        || item.totalPages !== item.previews.length || !item.pages.every((page, index) => page === index + 1)) return;
    const slides = [...block.querySelectorAll(':scope > figure')];
    if (slides.length !== item.previews.length) return;
    const doc = block.ownerDocument, controls = doc.createElement('div');
    const previous = doc.createElement('button'), next = doc.createElement('button'), status = doc.createElement('span');
    block.classList.add('evidence-pdf-carousel');
    block.setAttribute('role', 'group');block.setAttribute('aria-roledescription', 'carousel');
    block.setAttribute('aria-label', item.title);
    controls.className = 'evidence-pdf-controls';
    previous.type = next.type = 'button';
    previous.textContent = '←';next.textContent = '→';
    previous.setAttribute('aria-label', 'Previous page');next.setAttribute('aria-label', 'Next page');
    status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');status.setAttribute('aria-atomic', 'true');
    slides.forEach((slide, index) => {
      slide.setAttribute('role', 'group');slide.setAttribute('aria-roledescription', 'slide');
      slide.setAttribute('aria-label', 'Page ' + (index + 1) + ' of ' + slides.length);
      const image = slide.querySelector('img'), link = image.closest('a');
      const frame = doc.createElement('div'), feedback = doc.createElement('div');
      const message = doc.createElement('p'), retry = doc.createElement('button'), open = doc.createElement('a');
      frame.className = 'evidence-pdf-frame';feedback.className = 'evidence-pdf-feedback';
      message.setAttribute('aria-live', 'polite');
      retry.type = 'button';retry.textContent = 'Retry page';
      retry.setAttribute('aria-label', 'Retry page ' + (index + 1) + ' preview');
      open.href = item.downloadURL.href;open.textContent = 'Open PDF';
      link.before(frame);frame.append(link);feedback.append(message, retry, open);frame.append(feedback);
      let generation = 0;
      const failed = token => {
        if (token !== generation) return;
        frame.dataset.state = 'error';frame.setAttribute('aria-busy', 'false');
        message.textContent = 'Page preview could not load. Retry or open the PDF.';
        retry.disabled = false;retry.hidden = false;feedback.hidden = false;
      };
      const loaded = async token => {
        try {
          if (typeof image.decode === 'function') await image.decode();
          if (!image.naturalWidth) throw new Error('Empty preview');
          if (token !== generation) return;
          frame.dataset.state = 'ready';frame.setAttribute('aria-busy', 'false');
          if (doc.activeElement === retry) link.focus({preventScroll: true});
          feedback.hidden = true;
        } catch { failed(token); }
      };
      const load = again => {
        generation += 1;frame.dataset.state = 'loading';frame.setAttribute('aria-busy', 'true');
        message.textContent = 'Loading page ' + (index + 1) + ' preview…';
        retry.hidden = !again;retry.disabled = again;feedback.hidden = false;
        if (again) {
          const url = new URL(image.src);
          url.searchParams.set('preview_retry', Date.now().toString());image.src = url.href;
        }
        // These few poster pages are small. Start them together, including
        // hidden slides, so a cold-cache Next never reveals a partial image.
        image.loading = 'eager';
        if (image.complete) image.naturalWidth ? loaded(generation) : failed(generation);
      };
      image.addEventListener('load', () => loaded(generation));
      image.addEventListener('error', () => failed(generation));
      retry.addEventListener('click', () => load(true));load(false);
    });
    let current = 0;
    function show(index) {
      current = index;
      slides.forEach((slide, number) => {
        const active = number === current;
        // Invisible slides still size the shared grid row, including captions.
        // The frame and controls therefore stay put even for different pages.
        slide.hidden = false;slide.classList.toggle('is-current', active);
        slide.inert = !active;slide.setAttribute('aria-hidden', String(!active));
      });
      previous.disabled = current === 0;next.disabled = current === slides.length - 1;
      status.textContent = 'Page ' + (current + 1) + ' of ' + slides.length;
    }
    previous.addEventListener('click', () => show(Math.max(0, current - 1)));
    next.addEventListener('click', () => show(Math.min(slides.length - 1, current + 1)));
    block.addEventListener('blog-media-reveal', event => {
      const target = event.detail?.target || event.target;
      const index = slides.findIndex(slide => slide === target || slide.contains(target));
      if (index >= 0) show(index);
    });
    controls.append(previous, status, next);block.append(controls);show(0);
  }

  function alignPane(body, pane) {
    const copy = body.closest('.post-copy') || body;
    const sideBySide = pane.getBoundingClientRect().left >= copy.getBoundingClientRect().right;
    const bodyBox = body.getBoundingClientRect();
    const collapsed = body.classList.contains('post-collapsed');
    for (const block of pane.children) {
      if (body.ownerDocument.fullscreenElement === block) continue;
      const anchor = mediaAnchors.get(block);
      const mention = anchor && body.contains(anchor) ? anchor.getClientRects()[0] : null;
      // Static fallbacks without a mention belong after the article. A clipped
      // mention must be revealed by Show more before its media is shown.
      const target = mention?.top ?? bodyBox.bottom;
      block.hidden = collapsed && (!mention || mention.bottom > bodyBox.bottom);
      if (block.hidden || !sideBySide) {
        block.style.removeProperty('--media-offset');
        continue;
      }
      const previousOffset = parseFloat(block.style.getPropertyValue('--media-offset')) || 0;
      const naturalTop = block.getBoundingClientRect().top - previousOffset;
      const offset = Math.max(0, target - naturalTop);
      block.style.setProperty('--media-offset', offset + 'px');
    }
  }

  function watchPaneLayout(body, pane) {
    let layout = paneLayouts.get(pane);
    if (!layout) {
      let pending = false;
      const schedule = () => {
        if (pending) return;
        pending = true;
        root.requestAnimationFrame(() => { pending = false;alignPane(body, pane); });
      };
      const resize = new root.ResizeObserver(schedule);
      const changes = new root.MutationObserver(schedule);
      changes.observe(body.closest('.post-copy') || body, {childList: true, subtree: true,
        characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
      root.addEventListener('resize', schedule);
      body.ownerDocument.fonts?.ready.then(schedule);
      layout = {resize, changes, schedule};
      paneLayouts.set(pane, layout);
    }
    layout.resize.disconnect();
    layout.resize.observe(body.closest('.post-copy') || body);
    layout.resize.observe(body);
    for (const block of pane.children) layout.resize.observe(block);
    // Lay out immediately too, so a newly rendered frame does not flash above
    // its introduction while waiting for resize/font notifications.
    alignPane(body, pane);
    layout.schedule();
  }

  function renderPane(body, pane, entries = []) {
    const available = [...pane.children];
    const blocks = [];
    for (const item of mediaIn(body, entries)) {
      if (blocks.some(block => block.dataset.mediaKey === item.key)) continue;
      const block = available.find(block => block.dataset.mediaKey === item.key) || createMedia(body.ownerDocument, item);
      mediaAnchors.set(block, item.anchor);
      if (item.type === 'video') {
        block.querySelector('iframe').title = item.title;
        block.querySelector('figcaption').textContent = item.title;
      } else if (item.type === 'image') {
        block.id = imageFragment(item.url, body.ownerDocument.baseURI, siteBase).slice(1);
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
    // Reuse linked server-rendered media in source order, then retain any
    // unreferenced PDF or inline-media fallback after the linked items.
    blocks.push(...available.filter(block => block.hasAttribute('data-static-media') && !blocks.includes(block)));
    // Inline media retain a marker where they appeared in the writing. Include
    // those markers in first-mention order, leaving unmentioned fallbacks last.
    const mention = block => {
      const anchor = mediaAnchors.get(block);
      return anchor && body.contains(anchor) ? anchor : null;
    };
    blocks.sort((left, right) => {
      const first = mention(left), second = mention(right);
      if (!first || !second) return Number(!!second) - Number(!!first);
      if (first === second) return 0;
      return first.compareDocumentPosition(second) & root.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    for (const block of blocks) {
      const item = entries.find(entry => entry.key === block.dataset.mediaKey);
      if (item) {
        block.id = item.id + '-document';
        [...block.querySelectorAll(':scope > figure')].forEach((figure, index) => {
          figure.id = item.id + '-page-' + item.pages[index];
        });
        enhancePdf(block, item);
      }
    }
    // Preserve live frames across editor redraws and text edits. Neither the
    // editable HTML nor the serialized document gains media nodes.
    available.filter(block => !blocks.includes(block)).forEach(block => {
      demoCleanup.get(block)?.();demoCleanup.delete(block);demoStart.delete(block);block.remove();
    });
    blocks.forEach((block, index) => {
      if (pane.children[index] === block) return;
      const next = pane.children[index] || null;
      // Moving a connected iframe with insertBefore reloads its document.
      // Atomic moves retain playback as first-mention order changes.
      if (block.parentElement === pane && typeof pane.moveBefore === 'function') pane.moveBefore(block, next);
      else pane.insertBefore(block, next);
    });
    // Start opted-in demos once their block is attached. Reused blocks retain
    // their existing iframe and simulation state through ordinary text edits.
    blocks.forEach(block => {
      const start = demoStart.get(block);
      if (start) { demoStart.delete(block);start(); }
    });
    pane.hidden = !blocks.length;
    watchPaneLayout(body, pane);
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
      const marker = body.ownerDocument.createElement('span');
      marker.className = 'media-mention-marker';marker.setAttribute('aria-hidden', 'true');
      content.before(marker);mediaAnchors.set(block, marker);
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
      attributes: true, attributeFilter: ['href', 'id']});
    const references = body.closest('.post-copy')?.querySelector('#reference-preview');
    if (references && !body.contains(references)) observer.observe(references,
      {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'id']});
    return {observer, render};
  }

  const api = {youtubeId, imageURL, imageFragment, demoURL, pdfManifest, knownPdf, mediaIn, imageTarget, renderPane, enhanceArticle, watchPreview};
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
      let request = 0;
      const loadManifest = () => {
        const current = ++request;
        return root.fetch(new URL('assets/evidence/media.json', assetBase), {cache: 'no-store'}).then(response => {
          if (!response.ok) throw new Error('Media manifest unavailable');
          return response.json();
        }).then(data => {
          if (current !== request) return;
          entries = pdfManifest(data, assetBase);refresh();
        }).catch(() => {
          // Text links, video embeds and existing PDF previews remain usable.
        });
      };
      root.addEventListener('blog-media-published', loadManifest);
      loadManifest();
    }
  }
})(typeof window === 'object' ? window : globalThis);
