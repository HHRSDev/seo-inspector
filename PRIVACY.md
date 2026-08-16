# Privacy Policy — SEO Inspector

_Last updated: August 2026_

> The canonical version of this policy is published at
> **https://n5kwd.com/legal/seo-inspector-privacy** — that URL is the one
> referenced in the Chrome Web Store and Edge Add-ons listings.

SEO Inspector analyzes the web page in your active browser tab and displays an SEO report. All analysis happens entirely on your device.

## What the extension collects

**Nothing.** SEO Inspector does not collect, transmit, sell, or share any data. There are no analytics, no telemetry, no remote servers, and no network requests to the developer or any third party.

## What the extension stores locally

- **Preferences** (popup vs. sidebar mode, collapsed report sections) are saved with `chrome.storage.sync`, which your browser may sync across your own signed-in profile.
- **Analysis history** (page URL, score, check counts, timestamp for your last 200 analyses) is saved with `chrome.storage.local` and never leaves your device.

You can clear history at any time with the Clear button in the extension's history view, or remove all stored data by uninstalling the extension.

## Permissions

- **Access to websites (`http://*/*`, `https://*/*`)** is used solely to read the current page's SEO elements (title, meta tags, headings, images, links, structured data) when you use the extension. Page content is analyzed in place; only the report summary you see is derived from it.
- **storage** saves your preferences and local history as described above.
- **sidePanel** enables the sidebar view.

## Contact

Questions: open an issue at https://github.com/HHRSDev/seo-inspector/issues
