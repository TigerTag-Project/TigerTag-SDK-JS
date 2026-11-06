# Search and answer engines (SEO / GEO)

**Rule.** The SDK site built from `site/` is written to be found, understood and quoted
correctly by search engines and AI answer engines, **with verifiable facts only**. It is
checked by `site/seo_check.py` on every pull request that touches it and before every
deploy; a failing check is fixed, never bypassed.

**How.**

1. **Facts, not claims.** Every statement on the site is something `README.md`,
   `CHANGELOG.md` or `package.json` says, and can be checked there. No ranking, no "the
   best", no comparison with other projects. Never text or instructions aimed only at
   crawlers or AI: what an engine reads is what a person reads.
2. **Real code only.** Commands and code samples are the README's, line for line
   (`build.py --check` enforces it). The npm link is the one the README gives.
3. **Answer first.** A section opens with one sentence that answers its question. Common
   questions live in a visible FAQ, mirrored by the `FAQPage` JSON-LD.
4. **One complete page per language** (the eleven of `LANGS` in `site/build.py`): real
   text in that language, code untranslated, a self canonical, `hreflang` to every
   language plus `x-default`, `og:locale` with its alternates.
5. **Titles and descriptions.** Title at most 60 characters, description 50 to 160,
   unique per language, natural sentences with the words people search for (NFC tag,
   filament, Node.js, JavaScript SDK). `seo_check.py` warns past 60 / 160 and fails past
   70 / 200 or on a duplicate across languages.
6. **Structured data mirrors the page.** `Organization`, `WebSite`,
   `SoftwareSourceCode` (with the `package.json` version and `dateModified`) and
   `FAQPage`. One `<h1>` per page.
7. **Images.** An `alt` on every image; `alt=""` only on a decorative duplicate.
8. **Machine-readable copies stay in step.** `llms.txt` is published at the site root
   and linked from every page; the sitemap carries `<lastmod>`; `robots.txt` allows every
   crawler.
9. **No emoji**, no prices.

**Checks.** `python site/build.py --check`, then
`python site/build.py --out _site && python site/seo_check.py _site`.
