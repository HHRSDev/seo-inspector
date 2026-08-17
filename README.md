# SEO Inspector

A Chrome/Edge browser extension that inspects the current page and reports on its SEO elements in a clean popup interface.

**Install it from the [Microsoft Edge Add-ons store](https://microsoftedge.microsoft.com/addons/detail/seo-inspector/jnccodmlfhadmckeoamblfhiophcgbkf)** (Chrome Web Store listing pending review).

## What it checks

- **Title & Description** — presence, duplicates, and character-length guidance (title 30–60, description 70–160)
- **Metadata** — canonical URL, robots meta, viewport, `lang` attribute, charset, favicon, meta keywords (if present)
- **Headings** — H1 count (flags missing or multiple H1s), H1–H6 tag counts, and an outline of H1/H2 text
- **Title / H1 consistency** — warns when the title and H1 share few words (word-overlap comparison)
- **URL & Security** — HTTPS check, URL structure (length, query parameters, underscores, uppercase, path depth), mixed content (insecure resources on HTTPS pages, active vs. passive), and links to http:// destinations
- **Hreflang** — lists all `hreflang` alternates and flags invalid language codes, duplicates, non-absolute URLs, missing self-reference, and missing `x-default`
- **Preview & Icon Images** — renders the actual `og:image`, `twitter:image`, favicons, Apple touch icons, mask icons, and MS tile images inline, with "not set" placeholders for missing ones; also validates the og:image's dimensions (via `og:image:width/height` tags or by measuring the real image) against the 1200×630 recommendation
- **Social Tags** — Open Graph (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`, `og:site_name`) and Twitter Card tags
- **Structured Data** — JSON-LD blocks (flags parse errors), per-entity validation of recommended properties for common schema.org types (Article, Product, LocalBusiness, FAQPage, Recipe, Event, and more), plus Microdata/RDFa detection
- **Content** — word count (flags thin content under 300 words), keyword density (top single words and repeated two-word phrases, stopwords excluded), images missing alt text, internal/external link counts

## Reporting & export

- The copy button (⎘) copies the full report as plain text to the clipboard.
- The export button (⤓) downloads the report as **Markdown**, **CSV**, or **JSON**, named `seo-report-<host>-<timestamp>.<ext>`.
- The history button (🕓) shows the last analyses (up to 200 kept in `chrome.storage.local`) with score, counts, and timestamp per URL; rapid re-analyses of the same URL within a minute are collapsed into one entry. Clear wipes the list.

An overall **0–100 score** appears in the header (passes count fully, warnings half, failures zero; green ≥80, amber ≥50, red below). Sections are collapsible — click a section title — and the collapsed state is remembered across sessions. After an analysis, the toolbar icon shows a per-tab **badge** with the issue count (red if any check failed, amber for warnings only).

Each check shows a pass (green), warning (amber), or fail (red) indicator, with a summary tally in the footer.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Navigate to any web page and click the SEO Inspector icon in the toolbar.

## Popup or sidebar

The toolbar button can open the report as a **popup** (default) or in the browser **side panel** — switch with the Popup/Sidebar toggle in the footer. The choice is saved to `chrome.storage.sync` and applied by the background service worker, so it sticks across sessions (and syncs across profiles).

In sidebar mode the report stays open and re-analyzes automatically as you switch tabs or navigate. This requires `http/https` host permissions; the analysis still runs entirely locally and nothing is sent anywhere.

## Structure

```
manifest.json         Manifest V3 configuration
background.js         Applies the saved popup/sidebar preference to the toolbar button
popup/popup.html      Popup markup
popup/sidepanel.html  Side panel markup (same UI)
popup/popup.css       Shared styles (light + dark mode)
popup/popup.js        Analyzer (injected into the page) + report rendering
icons/                Toolbar icons
```
