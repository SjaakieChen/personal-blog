# Jiaqi Chen's blog

A minimal personal blog, made with plain HTML and CSS and hosted on GitHub Pages.

Website: https://sjaakiechen.github.io/personal-blog/

## Local preview

From this folder, run:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173. Stop the server with Ctrl+C.

## Editing

- `index.html` contains the homepage copy and writing section. It starts empty until a real post is ready.
- `styles.css` contains the typography, spacing, colours, and mobile layout. Shared colours are defined at the top.
- `404.html` is the missing-page screen; its links include the `/personal-blog/` GitHub Pages prefix so they work even for nested missing URLs. The local Python preview does not emulate GitHub's 404 routing or this project prefix.
- `.nojekyll` tells GitHub Pages to serve these files directly.

To add an article, create a new HTML page in `posts/`, link its stylesheet to `../styles.css`, and replace the homepage's empty state with an article link and publication date. No framework, installation, external fonts, tracking, or build step is required.

## Publishing

GitHub Pages serves the root of the `main` branch. Commit and push changes to publish them automatically. The Pages deployment appears in the repository's Actions tab and its settings are under Settings → Pages.
