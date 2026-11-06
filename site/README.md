# The SDK site

The public showcase of the TigerTag JavaScript SDK, published on GitHub Pages:
<https://tigertag-project.github.io/TigerTag-SDK-JS/>

It presents the SDK, shows how to install and use it, and links to the npm package,
the repository and the rest of the TigerTag ecosystem. It is static HTML, one page per
language, built by [`build.py`](build.py) and published by
[`pages.yml`](../.github/workflows/pages.yml) on every push to `main` that touches
`site/`, `README.md`, `CHANGELOG.md`, `package.json` or `llms.txt`. The same workflow
builds and checks the site on pull requests, without deploying.

Nothing here is part of the npm package (`files` in `package.json`, and `.npmignore`).

## Files

| File | Contents |
|---|---|
| [`template.html`](template.html) | The page. Every `{{key}}` is replaced by the text of that key in the page's language; `{{@…}}` keys are filled by `build.py` (language menu, `hreflang` links, JSON-LD, version, code samples). |
| [`i18n/en.json`](i18n/en.json) | The English text, which is the reference: every other language has exactly its keys. |
| `i18n/<lang>.json` | One file per language: `fr`, `de`, `es`, `it`, `zh` (Simplified Chinese), `pt` (Brazil), `pt-pt` (Portugal), `pl`, `ru`, `nl` — the languages of the other TigerTag sites. |
| [`site.css`](site.css), [`site.js`](site.js) | The look (dark by default, light on request) and the theme / language / copy buttons, the same as the TigerTag protocol site. Each page loads them with `?v=` and a hash of the file's content, so a new version is never hidden by a browser cache. |
| [`assets/`](assets/) | The TigerTag logos (white on the dark theme, contoured black on the light one) and `og.png`, the picture shown when the site is shared (1200 × 630). The favicon comes from the repository's `assets/`. |

## Where the facts come from

- The package name and version: `package.json`. The release date: the newest version in `CHANGELOG.md`.
- The quick start in the hero: read from the README's `## Quick start` section at build time.
- The other code samples: `CODE` in `build.py`, copied from the README. `build.py --check`
  fails when a line of them is no longer in the README, and when the README stops
  documenting `npm install <name>` or linking the npm page.
- Every sentence in `i18n/` states something the README, `CHANGELOG.md` or `package.json`
  says. A new fact goes to the README first.

## Editing

- **Change a text**: edit `i18n/en.json`, then the same key in every other language.
- **Add a text**: add the key to every `i18n/*.json` file and use `{{key}}` in `template.html`.
  The build refuses a language that misses a key, has an unknown one or an empty value.
- **Check and preview**:

  ```bash
  python3 site/build.py --check
  python3 site/build.py && python3 -m http.server 8000 --directory _site
  python3 site/build.py --only en   # English only, while translations are pending
  ```

- **Search and answer engines**: `python3 site/build.py --out _site && python3 site/seo_check.py _site`
  checks every page (title and description length, one `h1`, canonical and `hreflang`,
  sharing cards, `alt` text, JSON-LD types, the version and the FAQ they mirror, in-page
  links, no emoji, the install command, sitemap, robots, `llms.txt`). The rule behind it
  is [`.agents/rules/seo-geo.md`](../.agents/rules/seo-geo.md).

The English page is the root (`/`), every other language has its own folder (`/fr/`,
`/zh/`…), and the pages point to each other with `hreflang`. A language chosen in the
menu is remembered, and the English root forwards to it on the next visit.
