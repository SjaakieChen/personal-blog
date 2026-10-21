(function (root) {
  'use strict';

  function youtubeId(value) {
    if (typeof value !== 'string') return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === 'youtu.be') {
      id = url.pathname.slice(1);
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
        && url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
      id = url.searchParams.get('v');
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  }

  function videosIn(container) {
    return [...container.querySelectorAll('p')].flatMap(paragraph => {
      if (paragraph.closest('.references, [data-references], .explanation-notes, [data-notes]')) return [];
      const links = paragraph.querySelectorAll('a[href]');
      if (links.length !== 1) return [];
      const link = links[0], id = youtubeId(link.getAttribute('href'));
      if (!id || link.closest('[data-reference], [data-note], .citation')) return [];
      // Only an ordinary link and optional text formatting may fill the paragraph.
      const copy = paragraph.cloneNode(true);
      copy.querySelector('a').remove();
      if (copy.textContent.trim() || [...copy.querySelectorAll('*')].some(node =>
        !['STRONG', 'B', 'EM', 'I', 'U', 'SPAN'].includes(node.tagName))) return [];
      return [{paragraph, id, title: link.textContent.trim() || 'YouTube video'}];
    });
  }

  function createVideo(doc, video) {
    const figure = doc.createElement('figure');
    figure.className = 'evidence-video';
    figure.dataset.videoId = video.id;
    const frame = doc.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + video.id;
    frame.title = video.title;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    figure.append(frame);
    return figure;
  }

  function enhanceArchive(container) {
    for (const video of videosIn(container)) {
      const next = video.paragraph.nextElementSibling;
      if (next?.classList.contains('evidence-video') && next.dataset.videoId === video.id) continue;
      video.paragraph.after(createVideo(container.ownerDocument, video));
    }
  }

  function watchPreview(body, preview) {
    function render() {
      const videos = videosIn(body);
      // Reuse frames, including across editor redraws, so unrelated typing never
      // restarts playback. The editable document and its serialized runs stay intact.
      const available = [...preview.querySelectorAll('.evidence-video')];
      const figures = videos.map(video => {
        const index = available.findIndex(figure => figure.dataset.videoId === video.id);
        const figure = index < 0 ? createVideo(body.ownerDocument, video) : available.splice(index, 1)[0];
        figure.querySelector('iframe').title = video.title;
        return figure;
      });
      available.forEach(figure => figure.remove());
      figures.forEach((figure, index) => {
        if (preview.children[index] !== figure) preview.insertBefore(figure, preview.children[index] || null);
      });
      preview.hidden = !figures.length;
    }
    render();
    const observer = new root.MutationObserver(render);
    observer.observe(body, {childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['href']});
    return observer;
  }

  const api = {youtubeId, videosIn, enhanceArchive, watchPreview};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) {
    root.BlogEvidenceMedia = api;
    const body = root.document.getElementById('body');
    const preview = root.document.getElementById('evidence-media-preview');
    if (body && preview) watchPreview(body, preview);
    else root.document.querySelectorAll('.post-body').forEach(enhanceArchive);
  }
})(typeof window === 'object' ? window : globalThis);
