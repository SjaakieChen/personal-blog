# Personal blog

A minimal design canvas hosted on GitHub Pages.

Website: https://sjaakiechen.github.io/personal-blog/

## Local preview

From this folder, run:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173. Stop the server with Ctrl+C.

## Design

The page is intentionally empty: a full-height, square-edged muted blue sidebar beside a warm off-white canvas. There is no visible text or navigation yet.

- `index.html` contains the layout.
- `styles.css` defines the two colours and responsive sidebar width.
- `404.html` uses the same empty layout and a descriptive browser title. Its stylesheet includes the `/personal-blog/` prefix for nested missing URLs. The local Python server does not emulate Pages' custom 404 routing.
- `.nojekyll` tells GitHub Pages to serve these files directly.

## Publishing

GitHub Pages serves the root of `main`. Commit and push to publish changes automatically. No dependencies or build step are needed.
