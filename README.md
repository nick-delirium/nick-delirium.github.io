# nick-delirium.github.io

Source of **https://nick-delirium.github.io/**, a personal site whose animations are procedural ASCII drawn to a canvas. It uses no frameworks, and its only dependencies are the two build tools.

## Develop

```bash
npm install
npm run dev            # serve site/ at http://127.0.0.1:8642 (edits show on reload)
npm run build          # minified, hashed bundle in dist/
npm run preview        # build, then serve dist/ at http://127.0.0.1:8643
npm run scene <id>     # print one scene as ASCII, e.g. npm run scene gundam -- --size 120x60 --at 2,6
```

URL overrides for quick comparisons:

- `?theme=night-city|neon-noir|phosphor|smog`
- `?layout=split|window|bg`
- `?scene=<id>`, which pins an animation
- `?noboot`, which skips the boot screen

## Deploy

Every push to `main` that touches `site/`, the build or the workflow runs `.github/workflows/deploy.yml`. The workflow builds the site and publishes it to GitHub Pages; the Pages source in the repo settings must be **GitHub Actions**.

## Layout

```
site/index.html          all page content; each <section class="page"> is one full-screen page
site/css/main.css        4 themes, 3 layouts, print CV
site/js/main.js          settings, scroll-spy → scene, hover scenes, experience slider, boot
site/js/terminal.js      the ` terminal
site/js/engine/          glyph atlas renderer (cursor lens, shockwaves, bloom) and the Field framebuffer
site/js/scenes/*.js      the animations, lazy-loaded; index.js is the registry
tools/build.mjs          esbuild + html-minifier, with a size report
tools/serve.mjs          zero-dependency static server
tools/preview.mjs        run a scene headless and print it
tools/shot.mjs           headless Chrome over CDP: screenshots, PDF, console errors
```

- **Change a section's animation:** edit its `data-scene="…"`. Elements that also have `data-scene-hover` switch the animation on hover.
- **Add a scene:** export `{ id, title, caption, init(f, S), frame(f, t, dt, S, input) }` from `site/js/scenes/<id>.js`, then register it in `site/js/scenes/index.js`.
