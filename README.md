# nick-delirium.github.io

Serves **https://nick-delirium.github.io/**.

The site's source lives in [nick-delirium/nick-delirium](https://github.com/nick-delirium/nick-delirium) under `site/`. This repo holds only a workflow that checks that source out, builds it (`npm run build`) and deploys it to GitHub Pages. The workflow runs:

- whenever `site/` changes there, via a `repository_dispatch` event;
- once a day as a fallback;
- on demand from the Actions tab.
