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

The page currently shows four typography combinations in paired sidebar and main-content samples. The first combines EB Garamond titles and italic subtitles with Lora body text. The alternatives use Source Serif 4 body text, Libre Caslon Text headings, or Crimson Pro headings. Every option uses the same sample copy for comparison. On narrow screens, each sidebar sample stacks above its matching main sample. The Google Fonts stylesheet loads the specified upright, italic, and bold weights.

- `index.html` contains the layout.
- `styles.css` defines the two colours, font roles, spacing, responsive sidebar width, and mobile stacking.
- `404.html` uses the same empty layout and a descriptive browser title. Its stylesheet includes the `/personal-blog/` prefix for nested missing URLs. The local Python server does not emulate Pages' custom 404 routing.
- `.nojekyll` tells GitHub Pages to serve these files directly.

## Publishing

GitHub Pages serves the root of `main`. Commit and push to publish changes automatically. No dependencies or build step are needed.
