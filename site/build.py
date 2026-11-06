# SPDX-License-Identifier: Apache-2.0
#
# TigerTag SDK
# Copyright (c) 2025-2026 TigerSystem.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Build the TigerTag JavaScript SDK showcase site (GitHub Pages) into `_site/`.

One static page per language, all from `template.html` and `i18n/<lang>.json`:
English at the root, the others under `/<lang>/`. Every page is complete HTML in
its own language, with `hreflang` links between them, JSON-LD in its language and
a sitemap listing them all.

The facts that change with a release are read from the repository itself: the
package name and version from `package.json`, the release date from
`CHANGELOG.md`, and the code samples from `README.md` (or copied from it), so the
page never shows a command or an API the README does not document.

Usage:
    python site/build.py                 # build into _site/
    python site/build.py --check         # only check the translations
    python site/build.py --out DIR --url https://example.org/path/
"""

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SITE_URL = "https://tigertag-project.github.io/TigerTag-SDK-JS/"
REPO_URL = "https://github.com/TigerTag-Project/TigerTag-SDK-JS"

# The eleven languages of the TigerTag sites, in the same order. `pt` (Brazil)
# and `pt-pt` (Portugal) are separate dictionaries on purpose.
LANGS = ["en", "fr", "de", "es", "it", "zh", "pt", "pt-pt", "pl", "ru", "nl"]

# The share picture: tigersystem.io draws this page's card in each language,
# with the same renderer as its own pages, so the site keeps no picture of its own.
SHARE_CARD = "https://tigersystem.io/{lang}/sdk-js/opengraph-image"
HTML_LANG = {"zh": "zh-Hans", "pt": "pt-BR", "pt-pt": "pt-PT"}
OG_LOCALE = {"en": "en_US", "fr": "fr_FR", "de": "de_DE", "es": "es_ES", "it": "it_IT",
             "zh": "zh_CN", "pt": "pt_BR", "pt-pt": "pt_PT", "pl": "pl_PL", "ru": "ru_RU", "nl": "nl_NL"}

# Repository file -> published path under assets/.
ASSETS = {
    "assets/favicon.svg": "favicon.svg",
    "assets/apple-touch-icon.png": "apple-touch-icon.png",
}

# Crawlers of search and answer engines, welcomed by name in robots.txt. Listing
# them is an explicit opt-in, not a ranking trick.
AI_AGENTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User",
             "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot",
             "Amazonbot", "Bytespider", "Meta-ExternalAgent", "cohere-ai", "DuckAssistBot", "MistralAI-User"]

ORG_ID = "https://tigersystem.io/#organization"
FAQ_COUNT = 7

# Code shown on the page, copied verbatim from README.md (the quick start is read
# from it at build time). Code is never translated.
CODE = {
    "install": "npm install {name}",
    "install_alt": "pnpm add {name}\nyarn add {name}\nbun add {name}",
    "read": """// Node.js — nfc-pcsc (ACR122U / PN532)
reader.on('card', async (card) => {
  const uid = Buffer.from(card.uid, 'hex');        // 7 bytes
  const payload = await reader.read(4, 144, 4);    // pages 4–39, 144 bytes
  const tag = TigerTag.fromPages(uid, payload);
  console.log(tag.pretty());
  console.log(String(tag.verify()));               // VALID / NOT SIGNED
});""",
    "write": """// Immutable surgical update — returns a new TigerTag, original unchanged
const patched = tag.patch({ nozzleTempMin: 200, dryTemp: 55 });

// Erase a chip — write the returned 80 bytes to the NFC chip
const blankBytes = TigerTag.erase();""",
    "cli": """# Parse a dump file
tigertag dump.bin

# JSON output
tigertag dump.bin --json

# Update the reference tables now (into the data dir)
tigertag update""",
    "electron": """// main.js — replace parseTigerTag() subprocess dependency
const { TigerTag, TigerTagDB } = require('tigertag');

function parseTigerTag(payload, uid) {
  const tag = TigerTag.fromPages(Buffer.from(uid), Buffer.from(payload));
  const db  = new TigerTagDB();
  return {
    dict: tag.toDict(db),
    raw:  tag.toRawDict(),
    sig:  tag.verify(db).toDict(),
  };
}""",
    "playground": """npm run playground
# then open http://localhost:7432/tools/playground.html

# Enable live reader support (one-time install)
npm install ws nfc-pcsc""",
}


def package():
    return json.loads((REPO / "package.json").read_text(encoding="utf-8"))


def readme():
    return (REPO / "README.md").read_text(encoding="utf-8")


def readme_block(text, heading, lang):
    """The first fenced code block of `lang` under a README heading."""
    start = text.find(f"\n{heading}\n")
    if start < 0:
        raise SystemExit(f"error: README.md has no {heading!r} section")
    match = re.compile(rf"```{lang}\n(.*?)\n```", re.S).search(text, start)
    if not match:
        raise SystemExit(f"error: README.md {heading!r} has no {lang} code block")
    return match.group(1)


def check_code(text, name):
    """Every sample shown on the page is in the README, line for line."""
    problems = []
    for key, code in CODE.items():
        for line in code.replace("{name}", name).splitlines():
            line = line.strip()
            if line and line not in text and not line.startswith("# then open"):
                problems.append(f"{key}: {line!r}")
    if problems:
        raise SystemExit("error: code samples not found in README.md\n  " + "\n  ".join(problems))


def release_date():
    """The date of the newest released version in CHANGELOG.md (YYYY-MM-DD)."""
    text = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
    match = re.search(r"^## \[\d+\.\d+\.\d+\][^\n]*?(\d{4}-\d{2}-\d{2})", text, re.M)
    return match.group(1) if match else ""


def highlight(code, comment):
    """Escape a code sample and colour its comments and strings."""
    out = []
    for line in code.splitlines():
        pos = line.find(comment)
        # A '#' only starts a comment at the start of a shell line or after a space.
        if comment == "#" and pos > 0 and line[pos - 1] != " ":
            pos = -1
        body, note = (line[:pos], line[pos:]) if pos >= 0 else (line, "")
        body = html.escape(body, quote=False)
        body = re.sub(r"'[^'\n]*'", lambda m: f'<span class="s">{m.group(0)}</span>', body)
        if note:
            body += f'<span class="c">{html.escape(note, quote=False)}</span>'
        out.append(body)
    return "\n".join(out)


def asset_version(name):
    """Short sha256 of a published site file, appended to its URL as ?v=."""
    return hashlib.sha256((HERE / name).read_bytes()).hexdigest()[:10]


def site_date():
    """The page's last change, from git (the site, the README, the package)."""
    import subprocess
    from datetime import datetime, timezone
    try:
        date = subprocess.run(["git", "log", "-1", "--format=%cI", "--", "site", "README.md", "package.json"],
                              cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()[:10]
    except (OSError, subprocess.CalledProcessError):
        date = ""
    return date or datetime.now(timezone.utc).date().isoformat()


PLACEHOLDER = re.compile(r"\{\{([a-z0-9_@]+)\}\}")


def load_dictionaries():
    """Every language, checked against English: same keys, none empty."""
    dicts = {}
    for lang in LANGS:
        path = HERE / "i18n" / f"{lang}.json"
        if not path.exists():
            raise SystemExit(f"error: missing translation {path.relative_to(REPO)}")
        dicts[lang] = json.loads(path.read_text(encoding="utf-8"))
    reference = list(dicts["en"])
    problems = []
    for lang, words in dicts.items():
        missing = [k for k in reference if k not in words]
        extra = [k for k in words if k not in dicts["en"]]
        empty = [k for k, v in words.items() if not isinstance(v, str) or not v.strip()]
        for label, keys in (("missing", missing), ("unknown", extra), ("empty", empty)):
            if keys:
                problems.append(f"{lang}.json: {label} key(s): {', '.join(keys)}")
    template_keys = set(PLACEHOLDER.findall((HERE / "template.html").read_text(encoding="utf-8")))
    unused = [k for k in template_keys if not k.startswith("@") and k not in dicts["en"]]
    if unused:
        problems.append(f"template.html uses unknown key(s): {', '.join(sorted(unused))}")
    if problems:
        raise SystemExit("error: translations do not match en.json\n  " + "\n  ".join(problems))
    return dicts


def page_path(lang):
    return "" if lang == "en" else f"{lang}/"


def render(template, lang, words, dicts, site_url, ctx):
    base = "" if lang == "en" else "../"
    url = site_url + page_path(lang)
    pkg = ctx["package"]
    hl = HTML_LANG.get(lang, lang)

    alternates = [f'<link rel="alternate" hreflang="{HTML_LANG.get(l, l)}" href="{site_url}{page_path(l)}">' for l in LANGS]
    alternates.append(f'<link rel="alternate" hreflang="x-default" href="{site_url}">')

    menu = []
    for l in LANGS:
        current = ' aria-current="true"' if l == lang else ""
        menu.append(f'          <li><a href="{base}{page_path(l)}" hreflang="{HTML_LANG.get(l, l)}" '
                    f'lang="{HTML_LANG.get(l, l)}" data-lang="{l}"{current}>{html.escape(dicts[l]["lang_name"])}</a></li>')

    faq = [{"@type": "Question", "name": words[f"faq{i}_q"],
            "acceptedAnswer": {"@type": "Answer", "text": words[f"faq{i}_a"]}} for i in range(1, FAQ_COUNT + 1)]
    jsonld = [
        {"@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID, "name": "TigerSystem",
         "url": "https://tigersystem.io", "logo": site_url + "assets/apple-touch-icon.png",
         "sameAs": ["https://github.com/TigerTag-Project", "https://tigertag-project.github.io/TigerTag-RFID-Guide/"]},
        {"@context": "https://schema.org", "@type": "WebSite", "name": "TigerTag JavaScript SDK", "url": url,
         "inLanguage": hl, "description": words["meta_description"], "publisher": {"@id": ORG_ID}},
        {"@context": "https://schema.org", "@type": "SoftwareSourceCode", "name": "TigerTag JavaScript SDK",
         "alternateName": pkg["name"], "description": words["meta_description"], "inLanguage": hl,
         "url": url, "codeRepository": REPO_URL, "programmingLanguage": "JavaScript",
         "runtimePlatform": "Node.js " + pkg.get("engines", {}).get("node", ""),
         "version": pkg["version"], "dateModified": ctx["date"],
         "license": "https://www.apache.org/licenses/LICENSE-2.0",
         "image": SHARE_CARD.format(lang=lang),
         "isBasedOn": "https://github.com/TigerTag-Project/TigerTag-RFID-Guide",
         "author": {"@id": ORG_ID}, "publisher": {"@id": ORG_ID}},
        {"@context": "https://schema.org", "@type": "FAQPage", "inLanguage": hl, "mainEntity": faq},
    ]
    # `</` never appears inside a <script> block.
    jsonld_html = "\n".join('<script type="application/ld+json">' + json.dumps(j, ensure_ascii=False).replace("</", "<\\/") + "</script>"
                            for j in jsonld)

    special = {
        "@lang": lang,
        "@ogimage": SHARE_CARD.format(lang=lang),
        "@htmllang": hl,
        "@oglocale": OG_LOCALE[lang],
        "@oglocalealt": "\n".join(f'<meta property="og:locale:alternate" content="{OG_LOCALE[l]}">' for l in LANGS if l != lang),
        "@url": url,
        "@siteurl": site_url,
        "@base": base,
        "@langpath": page_path(lang),
        "@alternates": "\n".join(alternates),
        "@langmenu": "\n".join(menu),
        "@jsonld": jsonld_html,
        "@name": html.escape(pkg["name"]),
        "@version": html.escape(pkg["version"]),
        "@npm": ctx["npm"],
        "@repo": REPO_URL,
        "@vcss": asset_version("site.css"),
        "@vjs": asset_version("site.js"),
        "@trademark": f'<a href="https://github.com/TigerTag-Project/TigerTag-RFID-Guide/blob/main/TRADEMARK.md">{html.escape(words["foot_trademark"])}</a>',
    }
    for key, code in ctx["code"].items():
        special["@code_" + key] = code

    def fill(match):
        key = match.group(1)
        if key in special:
            return special[key]
        return html.escape(words[key].replace("{date}", ctx["released"]), quote=True)

    return PLACEHOLDER.sub(fill, template)


def context():
    pkg = package()
    text = readme()
    name = pkg["name"]
    if f"npm install {name}" not in text:
        raise SystemExit(f"error: README.md does not document `npm install {name}`")
    # The npm page, only as the README links it.
    npm = f"https://www.npmjs.com/package/{name}"
    if npm not in text:
        raise SystemExit(f"error: README.md does not link {npm}")
    check_code(text, name)
    code = {key: highlight(value.replace("{name}", name), "#" if key in ("install", "install_alt", "cli", "playground") else "//")
            for key, value in CODE.items()}
    code["quick"] = highlight(readme_block(text, "## Quick start", "js"), "//")
    return {"package": pkg, "npm": npm, "code": code, "date": site_date(), "released": release_date()}


def build(out, site_url):
    dicts = load_dictionaries()
    template = (HERE / "template.html").read_text(encoding="utf-8")
    ctx = context()
    if out.exists():
        shutil.rmtree(out)
    (out / "assets").mkdir(parents=True)

    for lang in LANGS:
        target = out / page_path(lang) / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(template, lang, dicts[lang], dicts, site_url, ctx), encoding="utf-8")

    for name in ("site.css", "site.js"):
        shutil.copy2(HERE / name, out / name)
    for source, published in ASSETS.items():
        shutil.copy2(REPO / source, out / "assets" / published)
    # Pictures made for the site itself (site/assets/), and the sharing card.
    for extra in sorted((HERE / "assets").glob("*")):
        shutil.copy2(extra, out / "assets" / extra.name)
    # The machine-readable description of the SDK, at the site root too.
    shutil.copy2(REPO / "llms.txt", out / "llms.txt")

    urls = "\n".join(
        "  <url><loc>{}</loc><lastmod>{}</lastmod>{}</url>".format(
            site_url + page_path(lang), ctx["date"],
            "".join(f'<xhtml:link rel="alternate" hreflang="{HTML_LANG.get(l, l)}" href="{site_url}{page_path(l)}"/>' for l in LANGS))
        for lang in LANGS)
    (out / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        f"{urls}\n</urlset>\n", encoding="utf-8")
    robots = ["User-agent: *", "Allow: /", ""]
    for agent in AI_AGENTS:
        robots += [f"User-agent: {agent}", "Allow: /", ""]
    robots += [f"Sitemap: {site_url}sitemap.xml"]
    (out / "robots.txt").write_text("\n".join(robots) + "\n", encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    print(f"built {len(LANGS)} languages into {out}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(REPO / "_site"))
    parser.add_argument("--url", default=SITE_URL)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--only", help="comma-separated languages, for a quick local preview")
    args = parser.parse_args()
    if args.only:
        LANGS[:] = [l for l in LANGS if l in args.only.split(",")]
    if args.check:
        load_dictionaries()
        context()
        print(f"translations and code samples OK: {len(LANGS)} languages")
        return
    url = args.url if args.url.endswith("/") else args.url + "/"
    build(Path(args.out), url)


if __name__ == "__main__":
    sys.exit(main())
