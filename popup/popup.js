// Runs in the page context via chrome.scripting.executeScript.
// Must be self-contained: no references to popup scope.
async function collectSeoData() {
  const metaContent = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.getAttribute("content") : null;
  };

  const titleEl = document.querySelector("title");

  const headings = [];
  const headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    const tag = h.tagName.toLowerCase();
    headingCounts[tag]++;
    if (tag === "h1" || tag === "h2") {
      headings.push({ tag, text: h.textContent.trim().slice(0, 120) });
    }
  });

  const images = document.querySelectorAll("img");
  let imagesMissingAlt = 0;
  images.forEach((img) => {
    if (!img.hasAttribute("alt") || img.getAttribute("alt").trim() === "") {
      imagesMissingAlt++;
    }
  });

  const jsonLd = { blocks: 0, parseErrors: 0, entities: [] };
  document
    .querySelectorAll('script[type="application/ld+json"]')
    .forEach((script) => {
      jsonLd.blocks++;
      try {
        const parsed = JSON.parse(script.textContent);
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        nodes.forEach((node) => {
          if (!node || typeof node !== "object") return;
          const hasContext = "@context" in node;
          const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [node];
          graph.forEach((item) => {
            if (!item || typeof item !== "object") return;
            const type = item["@type"];
            jsonLd.entities.push({
              type: Array.isArray(type) ? type.join(", ") : type ? String(type) : null,
              keys: Object.keys(item).filter((k) => !k.startsWith("@")),
              hasContext,
            });
          });
        });
      } catch {
        jsonLd.parseErrors++;
      }
    });
  jsonLd.entities = jsonLd.entities.slice(0, 25);

  const microdataCount = document.querySelectorAll("[itemscope]").length;
  const microdataTypes = [
    ...new Set(
      [...document.querySelectorAll("[itemscope][itemtype]")].map((n) =>
        (n.getAttribute("itemtype") || "").split("/").pop()
      )
    ),
  ].slice(0, 10);
  const rdfaCount = document.querySelectorAll("[typeof]").length;

  const hreflangs = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(
    (l) => ({ lang: l.getAttribute("hreflang"), href: l.getAttribute("href") })
  );

  // Visible-text statistics for word count and keyword density
  const bodyText = document.body ? document.body.innerText : "";
  const tokens = bodyText.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const wordCount = tokens.length;
  const STOP = new Set(
    ("a,an,the,and,or,but,if,then,else,when,while,for,to,of,in,on,at,by,with,from,as,is,are," +
      "was,were,be,been,being,it,its,this,that,these,those,i,you,he,she,we,they,them,his,her," +
      "their,our,your,my,me,us,not,no,do,does,did,done,have,has,had,will,would,can,could," +
      "should,may,might,must,shall,about,into,over,under,after,before,between,out,up,down," +
      "off,so,than,too,very,just,also,there,here,what,which,who,whom,how,why,where,all,any," +
      "both,each,few,more,most,other,some,such,only,own,same,now,get,got,one,two,new,use," +
      "using,used,via,per,etc").split(",")
  );
  const freq = new Map();
  const phraseFreq = new Map();
  let prevWord = null;
  tokens.forEach((w) => {
    if (STOP.has(w) || w.length < 3 || /^\d+$/.test(w)) {
      prevWord = null;
      return;
    }
    freq.set(w, (freq.get(w) || 0) + 1);
    if (prevWord) {
      const p = `${prevWord} ${w}`;
      phraseFreq.set(p, (phraseFreq.get(p) || 0) + 1);
    }
    prevWord = w;
  });
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({
      word,
      count,
      pct: wordCount ? +((count * 100) / wordCount).toFixed(1) : 0,
    }));
  const topPhrases = [...phraseFreq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => ({ phrase, count }));

  // Open Graph image dimensions: trust og:image:width/height meta tags if
  // present, otherwise load the image to measure it (3s timeout).
  const ogImageUrl = metaContent('meta[property="og:image"]');
  const ogMetaW = parseInt(metaContent('meta[property="og:image:width"]'), 10);
  const ogMetaH = parseInt(metaContent('meta[property="og:image:height"]'), 10);
  let ogImageDims = null;
  if (ogMetaW > 0 && ogMetaH > 0) {
    ogImageDims = { width: ogMetaW, height: ogMetaH, source: "meta tags" };
  } else if (ogImageUrl) {
    ogImageDims = await new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve({ error: "timed out" }), 3000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ width: img.naturalWidth, height: img.naturalHeight, source: "measured" });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve({ error: "failed to load" });
      };
      try {
        img.src = new URL(ogImageUrl, location.href).href;
      } catch {
        clearTimeout(timer);
        resolve({ error: "invalid URL" });
      }
    });
  }

  // Mixed content (https pages loading http resources) and insecure links
  const isHttps = location.protocol === "https:";
  let mixedActive = 0;
  let mixedPassive = 0;
  let insecureLinks = 0;
  if (isHttps) {
    document
      .querySelectorAll('script[src], link[rel="stylesheet"][href], iframe[src]')
      .forEach((n) => {
        const u = n.src || n.href || "";
        if (u.startsWith("http://")) mixedActive++;
      });
    document.querySelectorAll("img[src], audio[src], video[src], source[src]").forEach((n) => {
      if ((n.src || "").startsWith("http://")) mixedPassive++;
    });
  }
  document.querySelectorAll("a[href]").forEach((a) => {
    if ((a.href || "").startsWith("http://")) insecureLinks++;
  });

  // Every image referenced from metadata: social previews, favicons, touch icons
  const absUrl = (u) => {
    try {
      return u ? new URL(u, location.href).href : null;
    } catch {
      return null;
    }
  };
  const metaImages = [];
  document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').forEach((l) => {
    metaImages.push({
      kind: "favicon",
      url: absUrl(l.getAttribute("href")),
      sizes: l.getAttribute("sizes") || null,
    });
  });
  document
    .querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')
    .forEach((l) => {
      metaImages.push({
        kind: "apple-touch-icon",
        url: absUrl(l.getAttribute("href")),
        sizes: l.getAttribute("sizes") || null,
      });
    });
  document.querySelectorAll('link[rel="mask-icon"]').forEach((l) => {
    metaImages.push({ kind: "mask-icon", url: absUrl(l.getAttribute("href")), sizes: null });
  });
  const tileImage = metaContent('meta[name="msapplication-TileImage"]');
  if (tileImage) metaImages.push({ kind: "ms-tile", url: absUrl(tileImage), sizes: null });
  if (ogImageUrl) {
    metaImages.push({
      kind: "og:image",
      url: absUrl(ogImageUrl),
      sizes:
        ogImageDims && ogImageDims.width ? `${ogImageDims.width}x${ogImageDims.height}` : null,
    });
  }
  const twitterImageUrl = metaContent('meta[name="twitter:image"]');
  if (twitterImageUrl) {
    metaImages.push({ kind: "twitter:image", url: absUrl(twitterImageUrl), sizes: null });
  }

  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const faviconEl = document.querySelector(
    'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );

  let internalLinks = 0;
  let externalLinks = 0;
  document.querySelectorAll("a[href]").forEach((a) => {
    try {
      const url = new URL(a.href, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.hostname === location.hostname) internalLinks++;
      else externalLinks++;
    } catch {
      /* ignore malformed hrefs */
    }
  });

  return {
    url: location.href,
    title: titleEl ? titleEl.textContent.trim() : null,
    titleCount: document.querySelectorAll("title").length,
    description: metaContent('meta[name="description"]'),
    descriptionCount: document.querySelectorAll('meta[name="description"]').length,
    canonical: canonicalEl ? canonicalEl.getAttribute("href") : null,
    robots: metaContent('meta[name="robots"]'),
    viewport: metaContent('meta[name="viewport"]'),
    charset: document.characterSet || null,
    lang: document.documentElement.getAttribute("lang"),
    favicon: faviconEl ? faviconEl.getAttribute("href") : null,
    keywords: metaContent('meta[name="keywords"]'),
    og: {
      title: metaContent('meta[property="og:title"]'),
      description: metaContent('meta[property="og:description"]'),
      image: metaContent('meta[property="og:image"]'),
      url: metaContent('meta[property="og:url"]'),
      type: metaContent('meta[property="og:type"]'),
      siteName: metaContent('meta[property="og:site_name"]'),
    },
    twitter: {
      card: metaContent('meta[name="twitter:card"]'),
      title: metaContent('meta[name="twitter:title"]'),
      description: metaContent('meta[name="twitter:description"]'),
      image: metaContent('meta[name="twitter:image"]'),
    },
    headings,
    headingCounts,
    imageCount: images.length,
    imagesMissingAlt,
    jsonLd,
    microdataCount,
    microdataTypes,
    rdfaCount,
    hreflangs,
    wordCount,
    topWords,
    topPhrases,
    ogImageDims,
    metaImages: metaImages.filter((m) => m.url).slice(0, 20),
    isHttps,
    mixedActive,
    mixedPassive,
    insecureLinks,
    internalLinks,
    externalLinks,
  };
}

// ---- Popup logic ----

const STATUS = { PASS: "pass", WARN: "warn", FAIL: "fail", INFO: "info" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STATUS_SYMBOL = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]", info: "[i]" };

function imageCard({ kind, url, sizes }) {
  const card = el("div", "img-card");
  if (kind === "og:image" || kind === "twitter:image") card.classList.add("wide");
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = kind;
  img.title = url;
  img.addEventListener("error", () => {
    card.classList.add("broken");
    img.replaceWith(el("span", "img-broken", "✗ failed to load"));
  });
  img.src = url;
  card.appendChild(img);
  card.appendChild(el("div", "img-label", sizes ? `${kind} · ${sizes}` : kind));
  return card;
}

function missingImageCard(kind, why) {
  const card = el("div", "img-card missing");
  card.title = why;
  card.appendChild(el("span", "img-broken", "not set"));
  card.appendChild(el("div", "img-label", kind));
  return card;
}

// A single check row: colored status dot, label, optional right-aligned meta
// (e.g. character count), and the value underneath. `copyText` overrides the
// value used in the copy-to-clipboard report (needed when value is a DOM node).
function checkRow({ label, value, status = STATUS.INFO, meta, metaJudged = false, copyText }) {
  const row = el("div", `check status-${status}`);
  row.appendChild(el("span", "status-dot"));

  const labelWrap = el("div", "check-label");
  labelWrap.appendChild(el("span", null, label));
  if (meta) {
    labelWrap.appendChild(el("span", `check-meta${metaJudged ? " judged" : ""}`, meta));
  }
  row.appendChild(labelWrap);

  const valueNode = el("div", "check-value");
  if (value === null || value === undefined || value === "") {
    valueNode.classList.add("missing");
    valueNode.textContent = "Not found";
  } else if (value instanceof Node) {
    valueNode.appendChild(value);
  } else {
    valueNode.textContent = value;
  }
  row.appendChild(valueNode);

  let text = copyText;
  if (text === undefined) {
    text = value instanceof Node ? value.textContent.trim() : (value ?? "Not found");
  }
  const metaPart = meta ? ` (${meta})` : "";
  row._reportLine = `${STATUS_SYMBOL[status]} ${label}${metaPart}: ${text}`;
  row._reportRow = { label, status, meta: meta || "", text };
  return row;
}

// Accumulated during render; consumed by the copy and export buttons.
let reportText = "";
let reportLines = [];
let reportRows = [];
let reportMeta = null;

// Section collapsed/expanded state, persisted across sessions.
let collapsedSections = new Set();

async function loadCollapsedSections() {
  const { collapsedSections: saved } = await chrome.storage.sync.get({ collapsedSections: [] });
  collapsedSections = new Set(saved);
}

function saveCollapsedSections() {
  chrome.storage.sync.set({ collapsedSections: [...collapsedSections] });
}

function section(title, rows) {
  const sec = el("section");
  if (collapsedSections.has(title)) sec.classList.add("collapsed");
  const header = el("button", "section-header", title);
  header.type = "button";
  header.appendChild(el("span", "chevron"));
  header.addEventListener("click", () => {
    const nowCollapsed = sec.classList.toggle("collapsed");
    if (nowCollapsed) collapsedSections.add(title);
    else collapsedSections.delete(title);
    saveCollapsedSections();
  });
  sec.appendChild(header);
  const body = el("div", "section-body");
  reportLines.push("", `## ${title}`);
  rows.forEach((r) => {
    body.appendChild(r);
    if (r._reportLine) reportLines.push(r._reportLine);
    if (r._reportRow) reportRows.push({ section: title, ...r._reportRow });
  });
  sec.appendChild(body);
  return sec;
}

function judgeTitle(data) {
  if (!data.title) return { status: STATUS.FAIL, meta: "missing" };
  if (data.titleCount > 1) return { status: STATUS.FAIL, meta: `${data.titleCount} title tags` };
  const len = data.title.length;
  if (len < 30) return { status: STATUS.WARN, meta: `${len} chars — short` };
  if (len > 60) return { status: STATUS.WARN, meta: `${len} chars — long` };
  return { status: STATUS.PASS, meta: `${len} chars` };
}

function judgeDescription(data) {
  if (!data.description) return { status: STATUS.FAIL, meta: "missing" };
  if (data.descriptionCount > 1) {
    return { status: STATUS.FAIL, meta: `${data.descriptionCount} description tags` };
  }
  const len = data.description.length;
  if (len < 70) return { status: STATUS.WARN, meta: `${len} chars — short` };
  if (len > 160) return { status: STATUS.WARN, meta: `${len} chars — long` };
  return { status: STATUS.PASS, meta: `${len} chars` };
}

// Recommended properties for common schema.org types (Google rich-result guidance).
const SCHEMA_RECOMMENDED = {
  Article: ["headline", "image", "datePublished", "author"],
  BlogPosting: ["headline", "image", "datePublished", "author"],
  NewsArticle: ["headline", "image", "datePublished", "author"],
  Product: ["name", "image", "offers"],
  Offer: ["price", "priceCurrency"],
  Organization: ["name", "url"],
  LocalBusiness: ["name", "address"],
  Person: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Recipe: ["name", "image", "recipeIngredient", "recipeInstructions"],
  Event: ["name", "startDate", "location"],
  JobPosting: ["title", "hiringOrganization", "jobLocation", "datePosted"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  WebSite: ["name", "url"],
};

function validateEntity(entity) {
  if (!entity.type) return { status: STATUS.WARN, note: "missing @type" };
  const types = entity.type.split(",").map((t) => t.trim());
  const ruleType = types.find((t) => SCHEMA_RECOMMENDED[t]);
  if (!ruleType) return { status: STATUS.INFO, note: `${entity.keys.length} properties` };
  const missing = SCHEMA_RECOMMENDED[ruleType].filter((f) => !entity.keys.includes(f));
  if (missing.length > 0) return { status: STATUS.WARN, note: `missing: ${missing.join(", ")}` };
  return { status: STATUS.PASS, note: "recommended fields present" };
}

const HREFLANG_PATTERN = /^x-default$|^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

function judgeHreflangs(data) {
  const issues = [];
  const seen = new Set();
  let hasSelf = false;
  const normalize = (u) => {
    try {
      const url = new URL(u, data.url);
      return url.origin + url.pathname.replace(/\/$/, "") + url.search;
    } catch {
      return null;
    }
  };
  const pageUrl = normalize(data.url);

  data.hreflangs.forEach(({ lang, href }) => {
    if (!lang || !HREFLANG_PATTERN.test(lang)) issues.push(`invalid language code "${lang}"`);
    const key = (lang || "").toLowerCase();
    if (seen.has(key)) issues.push(`duplicate hreflang "${lang}"`);
    seen.add(key);
    if (href && !/^https?:\/\//i.test(href)) issues.push(`"${lang}" URL is not absolute`);
    if (normalize(href) === pageUrl) hasSelf = true;
  });
  if (!hasSelf) issues.push("no self-referencing hreflang for this page");

  const hasFail = issues.some((i) => i.startsWith("invalid") || i.startsWith("duplicate"));
  return {
    status: hasFail ? STATUS.FAIL : issues.length > 0 ? STATUS.WARN : STATUS.PASS,
    issues,
    hasXDefault: data.hreflangs.some((h) => (h.lang || "").toLowerCase() === "x-default"),
  };
}

function judgeOgImage(data) {
  const dims = data.ogImageDims;
  if (!dims) return null;
  if (dims.error) {
    return { status: STATUS.WARN, meta: "unverified", value: `Image ${dims.error}` };
  }
  const size = `${dims.width}×${dims.height} (${dims.source})`;
  if (dims.width < 200 || dims.height < 200) {
    return {
      status: STATUS.FAIL,
      meta: "too small",
      value: `${size} — below the 200×200 minimum most platforms require`,
    };
  }
  if (dims.width < 1200 || dims.height < 630) {
    return {
      status: STATUS.WARN,
      meta: "small",
      value: `${size} — under the 1200×630 recommended for large link previews`,
    };
  }
  return { status: STATUS.PASS, meta: "good size", value: size };
}

function contentWords(text) {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3)
  );
}

function judgeTitleH1(data) {
  const h1 = data.headings.find((h) => h.tag === "h1");
  if (!data.title || !h1 || !h1.text) return null;
  if (data.title.trim().toLowerCase() === h1.text.trim().toLowerCase()) {
    return { status: STATUS.PASS, meta: "identical", value: "Title and H1 are identical" };
  }
  const titleWords = contentWords(data.title);
  const h1Words = contentWords(h1.text);
  if (titleWords.size === 0 || h1Words.size === 0) return null;
  const shared = [...h1Words].filter((w) => titleWords.has(w)).length;
  const overlap = shared / Math.min(titleWords.size, h1Words.size);
  if (overlap >= 0.3) {
    return {
      status: STATUS.PASS,
      meta: `${Math.round(overlap * 100)}% overlap`,
      value: "Title and H1 are consistent",
    };
  }
  return {
    status: STATUS.WARN,
    meta: `${Math.round(overlap * 100)}% overlap`,
    value: `Title and H1 share few words — search engines expect them to agree on the page topic. H1: "${h1.text}"`,
  };
}

function judgeUrlStructure(data) {
  let url;
  try {
    url = new URL(data.url);
  } catch {
    return { status: STATUS.INFO, value: data.url };
  }
  const issues = [];
  const fullLength = data.url.length;
  const params = [...url.searchParams.keys()];
  const segments = url.pathname.split("/").filter(Boolean);
  if (fullLength > 100) issues.push(`long URL (${fullLength} chars)`);
  if (params.length > 2) issues.push(`${params.length} query parameters`);
  if (/_/.test(url.pathname)) issues.push("underscores in path (hyphens preferred)");
  if (/[A-Z]/.test(url.pathname)) issues.push("uppercase characters in path");
  if (segments.length > 4) issues.push(`deep path (${segments.length} levels)`);
  const summary = `${fullLength} chars, ${segments.length} path segment(s), ${params.length} parameter(s)`;
  return {
    status: issues.length > 0 ? STATUS.WARN : STATUS.PASS,
    meta: issues.length > 0 ? `${issues.length} issue(s)` : "clean",
    value: issues.length > 0 ? `${summary}\nIssues: ${issues.join("; ")}` : summary,
  };
}

function render(data) {
  const results = document.getElementById("results");
  results.textContent = "";
  reportLines = [];
  reportRows = [];

  const urlNode = document.getElementById("page-url");
  urlNode.textContent = data.url;
  urlNode.title = data.url;

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  const tally = (status) => {
    if (status === STATUS.PASS) passCount++;
    else if (status === STATUS.WARN) warnCount++;
    else if (status === STATUS.FAIL) failCount++;
    return status;
  };

  // --- Title & description ---
  const titleJudgement = judgeTitle(data);
  const descJudgement = judgeDescription(data);
  results.appendChild(
    section("Title & Description", [
      checkRow({
        label: "Title",
        value: data.title,
        status: tally(titleJudgement.status),
        meta: titleJudgement.meta,
        metaJudged: true,
      }),
      checkRow({
        label: "Meta description",
        value: data.description,
        status: tally(descJudgement.status),
        meta: descJudgement.meta,
        metaJudged: true,
      }),
      ...(() => {
        const j = judgeTitleH1(data);
        return j
          ? [
              checkRow({
                label: "Title / H1 consistency",
                value: j.value,
                status: tally(j.status),
                meta: j.meta,
                metaJudged: true,
              }),
            ]
          : [];
      })(),
    ])
  );

  // --- URL & security ---
  const urlJudgement = judgeUrlStructure(data);
  const mixedTotal = data.mixedActive + data.mixedPassive;
  results.appendChild(
    section("URL & Security", [
      checkRow({
        label: "HTTPS",
        value: data.isHttps ? "Page is served over HTTPS" : "Page is served over plain HTTP",
        status: tally(data.isHttps ? STATUS.PASS : STATUS.FAIL),
      }),
      checkRow({
        label: "URL structure",
        value: urlJudgement.value,
        status: tally(urlJudgement.status),
        meta: urlJudgement.meta,
        metaJudged: true,
      }),
      ...(data.isHttps
        ? [
            checkRow({
              label: "Mixed content",
              value:
                mixedTotal === 0
                  ? "No insecure (http://) resources loaded"
                  : `${data.mixedActive} active (scripts/styles/iframes), ${data.mixedPassive} passive (media) insecure resources`,
              status: tally(
                data.mixedActive > 0
                  ? STATUS.FAIL
                  : data.mixedPassive > 0
                    ? STATUS.WARN
                    : STATUS.PASS
              ),
              meta: mixedTotal > 0 ? `${mixedTotal} found` : "none",
              metaJudged: true,
            }),
          ]
        : []),
      checkRow({
        label: "Insecure links",
        value:
          data.insecureLinks === 0
            ? "No links to http:// destinations"
            : `${data.insecureLinks} link(s) point to http:// destinations`,
        status: tally(data.insecureLinks > 0 ? STATUS.WARN : STATUS.PASS),
        meta: data.insecureLinks > 0 ? `${data.insecureLinks} found` : "none",
        metaJudged: true,
      }),
    ])
  );

  // --- Indexing & document metadata ---
  const robotsBlocked = data.robots && /noindex|nofollow/i.test(data.robots);
  results.appendChild(
    section("Metadata", [
      checkRow({
        label: "Canonical URL",
        value: data.canonical,
        status: tally(data.canonical ? STATUS.PASS : STATUS.WARN),
      }),
      checkRow({
        label: "Robots meta",
        value: data.robots || "Not set (defaults to index, follow)",
        status: tally(robotsBlocked ? STATUS.WARN : STATUS.PASS),
      }),
      checkRow({
        label: "Viewport",
        value: data.viewport,
        status: tally(data.viewport ? STATUS.PASS : STATUS.WARN),
      }),
      checkRow({
        label: "Language",
        value: data.lang,
        status: tally(data.lang ? STATUS.PASS : STATUS.WARN),
      }),
      checkRow({
        label: "Charset",
        value: data.charset,
        status: STATUS.INFO,
      }),
      checkRow({
        label: "Favicon",
        value: data.favicon,
        status: tally(data.favicon ? STATUS.PASS : STATUS.WARN),
      }),
      ...(data.keywords
        ? [checkRow({ label: "Meta keywords", value: data.keywords, status: STATUS.INFO })]
        : []),
    ])
  );

  // --- Hreflang ---
  if (data.hreflangs.length === 0) {
    results.appendChild(
      section("Hreflang", [
        checkRow({
          label: "Hreflang tags",
          value: "None found — only needed for multilingual or multi-regional sites",
          status: STATUS.INFO,
          meta: "none",
        }),
      ])
    );
  } else {
    const judgement = judgeHreflangs(data);
    const valueNode = el("div");
    const list = el("ul", "heading-list");
    data.hreflangs.slice(0, 15).forEach(({ lang, href }) => {
      const li = el("li");
      li.appendChild(el("span", "tag", lang || "?"));
      li.appendChild(el("span", null, href || "(no href)"));
      list.appendChild(li);
    });
    if (data.hreflangs.length > 15) {
      const li = el("li");
      li.appendChild(el("span", null, `… and ${data.hreflangs.length - 15} more`));
      list.appendChild(li);
    }
    valueNode.appendChild(list);
    if (!judgement.hasXDefault) {
      valueNode.appendChild(
        el("div", null, "No x-default entry (recommended as a fallback for unmatched languages).")
      );
    }
    judgement.issues.forEach((issue) => {
      valueNode.appendChild(el("div", null, `Issue: ${issue}`));
    });
    results.appendChild(
      section("Hreflang", [
        checkRow({
          label: "Hreflang tags",
          value: valueNode,
          status: tally(judgement.status),
          meta: `${data.hreflangs.length} tags`,
          metaJudged: true,
          copyText:
            data.hreflangs.map((h) => `${h.lang} -> ${h.href}`).join("; ") +
            (judgement.issues.length > 0 ? ` | Issues: ${judgement.issues.join("; ")}` : ""),
        }),
      ])
    );
  }

  // --- Headings ---
  const h1Count = data.headingCounts.h1;
  const h1Status =
    h1Count === 1 ? STATUS.PASS : h1Count === 0 ? STATUS.FAIL : STATUS.WARN;
  const headingValue = el("div");
  const pills = el("div", "count-row");
  Object.entries(data.headingCounts).forEach(([tag, count]) => {
    const pill = el("span", "count-pill");
    pill.appendChild(el("strong", null, tag.toUpperCase()));
    pill.appendChild(document.createTextNode(` ${count}`));
    pills.appendChild(pill);
  });
  headingValue.appendChild(pills);
  if (data.headings.length > 0) {
    const list = el("ul", "heading-list");
    data.headings.slice(0, 12).forEach((h) => {
      const li = el("li");
      li.appendChild(el("span", "tag", h.tag));
      li.appendChild(el("span", null, h.text || "(empty)"));
      list.appendChild(li);
    });
    if (data.headings.length > 12) {
      const li = el("li");
      li.appendChild(el("span", null, `… and ${data.headings.length - 12} more`));
      list.appendChild(li);
    }
    headingValue.appendChild(list);
  }
  results.appendChild(
    section("Headings", [
      checkRow({
        label: "H1 heading",
        value: headingValue,
        status: tally(h1Status),
        meta:
          h1Count === 1 ? "1 H1" : h1Count === 0 ? "no H1" : `${h1Count} H1s`,
        metaJudged: true,
        copyText:
          Object.entries(data.headingCounts)
            .map(([tag, count]) => `${tag.toUpperCase()}: ${count}`)
            .join(", ") +
          (data.headings.length > 0
            ? " | " + data.headings.map((h) => `${h.tag.toUpperCase()} "${h.text}"`).join("; ")
            : ""),
      }),
    ])
  );

  // --- Social tags ---
  const ogComplete = data.og.title && data.og.description && data.og.image;
  const ogAny =
    data.og.title || data.og.description || data.og.image || data.og.url || data.og.type;
  const twitterAny =
    data.twitter.card || data.twitter.title || data.twitter.description || data.twitter.image;
  results.appendChild(
    section("Social Tags", [
      checkRow({
        label: "Open Graph",
        status: tally(ogComplete ? STATUS.PASS : ogAny ? STATUS.WARN : STATUS.FAIL),
        meta: ogComplete ? "complete" : ogAny ? "partial" : "missing",
        metaJudged: true,
        value: ogAny
          ? [
              data.og.title && `og:title: ${data.og.title}`,
              data.og.description && `og:description: ${data.og.description}`,
              data.og.image && `og:image: ${data.og.image}`,
              data.og.type && `og:type: ${data.og.type}`,
              data.og.url && `og:url: ${data.og.url}`,
              data.og.siteName && `og:site_name: ${data.og.siteName}`,
            ]
              .filter(Boolean)
              .join("\n")
          : null,
      }),
      checkRow({
        label: "Twitter Card",
        status: tally(twitterAny ? STATUS.PASS : STATUS.WARN),
        meta: twitterAny ? "present" : "missing",
        metaJudged: true,
        value: twitterAny
          ? [
              data.twitter.card && `twitter:card: ${data.twitter.card}`,
              data.twitter.title && `twitter:title: ${data.twitter.title}`,
              data.twitter.description && `twitter:description: ${data.twitter.description}`,
              data.twitter.image && `twitter:image: ${data.twitter.image}`,
            ]
              .filter(Boolean)
              .join("\n")
          : null,
      }),
      ...(() => {
        const j = judgeOgImage(data);
        return j
          ? [
              checkRow({
                label: "OG image size",
                value: j.value,
                status: tally(j.status),
                meta: j.meta,
                metaJudged: true,
              }),
            ]
          : [];
      })(),
    ])
  );

  // --- Preview & icon images ---
  const EXPECTED_IMAGES = [
    ["og:image", "Social share preview image — links look bare without one"],
    ["twitter:image", "Most platforms fall back to og:image"],
    ["favicon", "Browser tab icon"],
    ["apple-touch-icon", "iOS home-screen and share-sheet icon"],
  ];
  const presentKinds = new Set(data.metaImages.map((m) => m.kind));
  const imgGrid = el("div", "img-grid");
  data.metaImages.forEach((m) => imgGrid.appendChild(imageCard(m)));
  const missingKinds = EXPECTED_IMAGES.filter(([kind]) => !presentKinds.has(kind));
  missingKinds.forEach(([kind, why]) => imgGrid.appendChild(missingImageCard(kind, why)));
  // twitter:image alone missing is fine — it falls back to og:image
  const missingImportant = missingKinds.filter(([k]) => k !== "twitter:image");
  results.appendChild(
    section("Preview & Icon Images", [
      checkRow({
        label: "Metadata images",
        value: imgGrid,
        status: tally(missingImportant.length > 0 ? STATUS.WARN : STATUS.PASS),
        meta:
          missingImportant.length > 0
            ? `${missingImportant.length} missing`
            : `${data.metaImages.length} found`,
        metaJudged: true,
        copyText:
          data.metaImages.map((m) => `${m.kind}${m.sizes ? ` (${m.sizes})` : ""}: ${m.url}`).join("; ") +
          (missingKinds.length > 0
            ? ` | Missing: ${missingKinds.map(([k]) => k).join(", ")}`
            : ""),
      }),
    ])
  );

  // --- Structured data ---
  const sdRows = [];
  const jsonLdStatus =
    data.jsonLd.parseErrors > 0
      ? STATUS.FAIL
      : data.jsonLd.blocks > 0
        ? STATUS.PASS
        : STATUS.INFO;
  sdRows.push(
    checkRow({
      label: "JSON-LD",
      value:
        data.jsonLd.blocks === 0
          ? "No JSON-LD blocks found"
          : `${data.jsonLd.blocks} block(s), ${data.jsonLd.entities.length} entities` +
            (data.jsonLd.parseErrors > 0
              ? ` — ${data.jsonLd.parseErrors} block(s) failed to parse`
              : ""),
      status: tally(jsonLdStatus),
      meta:
        data.jsonLd.parseErrors > 0
          ? "parse error"
          : data.jsonLd.blocks > 0
            ? `${data.jsonLd.blocks} blocks`
            : "none",
      metaJudged: data.jsonLd.blocks > 0,
    })
  );
  data.jsonLd.entities.slice(0, 10).forEach((entity) => {
    const verdict = validateEntity(entity);
    const noContext = !entity.hasContext ? " (no @context)" : "";
    sdRows.push(
      checkRow({
        label: entity.type || "(untyped entity)",
        value: (verdict.note || "") + noContext,
        status: tally(verdict.status),
      })
    );
  });
  if (data.microdataCount > 0) {
    sdRows.push(
      checkRow({
        label: "Microdata",
        value: `${data.microdataCount} itemscope element(s): ${data.microdataTypes.join(", ")}`,
        status: STATUS.INFO,
      })
    );
  }
  if (data.rdfaCount > 0) {
    sdRows.push(
      checkRow({
        label: "RDFa",
        value: `${data.rdfaCount} element(s) with typeof attribute`,
        status: STATUS.INFO,
      })
    );
  }
  results.appendChild(section("Structured Data", sdRows));

  // --- Content ---
  const wordStatus = data.wordCount >= 300 ? STATUS.PASS : STATUS.WARN;
  const keywordNode = el("div", "count-row");
  data.topWords.forEach(({ word, count, pct }) => {
    const pill = el("span", "count-pill");
    pill.appendChild(el("strong", null, word));
    pill.appendChild(document.createTextNode(` ${count} (${pct}%)`));
    keywordNode.appendChild(pill);
  });
  const altStatus =
    data.imageCount === 0
      ? STATUS.INFO
      : data.imagesMissingAlt === 0
        ? STATUS.PASS
        : STATUS.WARN;
  results.appendChild(
    section("Content", [
      checkRow({
        label: "Word count",
        value:
          data.wordCount < 300
            ? `${data.wordCount} words — thin content (300+ recommended)`
            : `${data.wordCount} words`,
        status: tally(wordStatus),
        meta: `${data.wordCount} words`,
        metaJudged: true,
      }),
      ...(data.topWords.length > 0
        ? [
            checkRow({
              label: "Top keywords",
              value: keywordNode,
              status: STATUS.INFO,
              copyText: data.topWords
                .map((w) => `${w.word} ${w.count}x (${w.pct}%)`)
                .join(", "),
            }),
          ]
        : []),
      ...(data.topPhrases.length > 0
        ? [
            checkRow({
              label: "Top phrases",
              value: data.topPhrases.map((p) => `${p.phrase} (${p.count}x)`).join(", "),
              status: STATUS.INFO,
            }),
          ]
        : []),
      checkRow({
        label: "Image alt text",
        value:
          data.imageCount === 0
            ? "No images on page"
            : `${data.imageCount - data.imagesMissingAlt} of ${data.imageCount} images have alt text`,
        status: tally(altStatus),
        meta: data.imagesMissingAlt > 0 ? `${data.imagesMissingAlt} missing` : undefined,
        metaJudged: true,
      }),
      checkRow({
        label: "Links",
        value: `${data.internalLinks} internal, ${data.externalLinks} external`,
        status: STATUS.INFO,
      }),
    ])
  );

  const summaryText = `${passCount} passed · ${warnCount} warnings · ${failCount} failed`;
  document.getElementById("summary").textContent = summaryText;

  // Overall score: passes count fully, warnings half, failures zero.
  const judgedTotal = passCount + warnCount + failCount;
  const score =
    judgedTotal > 0 ? Math.round((100 * (passCount + warnCount * 0.5)) / judgedTotal) : null;
  const scoreNode = document.getElementById("score");
  if (score !== null) {
    scoreNode.textContent = score;
    scoreNode.className =
      "score-badge " + (score >= 80 ? "score-good" : score >= 50 ? "score-ok" : "score-poor");
    scoreNode.hidden = false;
  } else {
    scoreNode.hidden = true;
  }

  reportText = [
    `# SEO Report`,
    `URL: ${data.url}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Score: ${score !== null ? `${score}/100` : "n/a"}`,
    `Summary: ${summaryText}`,
    ...reportLines,
  ].join("\n");

  document.getElementById("loading").hidden = true;
  results.hidden = false;

  reportMeta = { url: data.url, ts: Date.now(), score };
  return { passCount, warnCount, failCount, score };
}

// ---- History ----

function scoreClass(score) {
  return score >= 80 ? "score-good" : score >= 50 ? "score-ok" : "score-poor";
}

async function saveToHistory(entry) {
  const { history } = await chrome.storage.local.get({ history: [] });
  // Sidebar mode re-analyzes constantly while browsing — collapse rapid
  // repeat analyses of the same URL into one entry.
  if (history[0] && history[0].url === entry.url && entry.ts - history[0].ts < 60000) {
    history[0] = entry;
  } else {
    history.unshift(entry);
  }
  await chrome.storage.local.set({ history: history.slice(0, 200) });
}

async function showHistory() {
  const { history } = await chrome.storage.local.get({ history: [] });
  const list = document.getElementById("history-list");
  list.textContent = "";
  if (history.length === 0) {
    list.appendChild(el("li", "history-empty", "No saved analyses yet."));
  }
  history.slice(0, 50).forEach((h) => {
    const li = el("li", "history-item");
    li.title = h.url;
    li.appendChild(el("span", `score-badge ${scoreClass(h.score)}`, String(h.score)));
    const info = el("div", "history-info");
    let short = h.url.replace(/^https?:\/\//, "");
    if (short.length > 52) short = `${short.slice(0, 52)}…`;
    info.appendChild(el("div", "history-url", short));
    info.appendChild(
      el(
        "div",
        "history-meta",
        `${new Date(h.ts).toLocaleString()} · ${h.pass} passed · ${h.warn} warnings · ${h.fail} failed`
      )
    );
    li.appendChild(info);
    list.appendChild(li);
  });
}

async function toggleHistory() {
  const view = document.getElementById("history-view");
  const show = view.hidden;
  if (show) await showHistory();
  view.hidden = !show;
  document.getElementById("results").hidden = show;
}

// ---- Export ----

function downloadReport(fmt) {
  if (!reportMeta) return;
  let host = "page";
  try {
    host = new URL(reportMeta.url).hostname || "page";
  } catch {
    /* keep default */
  }
  const stamp = new Date(reportMeta.ts).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  let content;
  let mime;
  if (fmt === "csv") {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    content = [
      "Section,Check,Status,Result,Details",
      ...reportRows.map((r) =>
        [r.section, r.label, r.status.toUpperCase(), r.meta, r.text].map(esc).join(",")
      ),
    ].join("\r\n");
    mime = "text/csv";
  } else if (fmt === "json") {
    content = JSON.stringify(
      {
        url: reportMeta.url,
        generated: new Date(reportMeta.ts).toISOString(),
        score: reportMeta.score,
        checks: reportRows,
      },
      null,
      2
    );
    mime = "application/json";
  } else {
    content = reportText;
    mime = "text/markdown";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = `seo-report-${host}-${stamp}.${fmt}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showError(message) {
  document.getElementById("loading").hidden = true;
  document.getElementById("results").hidden = true;
  document.getElementById("summary").textContent = "";
  const errNode = document.getElementById("error");
  errNode.textContent = message;
  errNode.hidden = false;
}

async function analyze() {
  document.getElementById("error").hidden = true;
  document.getElementById("history-view").hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showError("No active tab found.");
    return;
  }
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    showError("This page can't be analyzed. Open a regular web page (http/https) and try again.");
    return;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectSeoData,
    });
    const counts = render(result);
    const issues = counts.warnCount + counts.failCount;
    // Per-tab toolbar badge with the issue count; cleared when the page is clean.
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text: issues > 0 ? String(issues) : "" });
      if (issues > 0) {
        await chrome.action.setBadgeBackgroundColor({
          tabId: tab.id,
          color: counts.failCount > 0 ? "#c5221f" : "#b26a00",
        });
      }
    } catch {
      /* badge is cosmetic — ignore failures */
    }
    try {
      await saveToHistory({
        url: result.url,
        ts: Date.now(),
        score: counts.score,
        pass: counts.passCount,
        warn: counts.warnCount,
        fail: counts.failCount,
      });
    } catch {
      /* history is best-effort */
    }
  } catch (err) {
    showError(`Couldn't analyze this page: ${err.message}`);
  }
}

// ---- Popup vs. sidebar preference ----

const IS_SIDEBAR = document.body.classList.contains("sidebar");

function markActiveMode(mode) {
  document.querySelectorAll("#mode-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

async function setupModeSwitch() {
  const { mode } = await chrome.storage.sync.get({ mode: "popup" });
  markActiveMode(mode);

  document.querySelectorAll("#mode-switch button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newMode = btn.dataset.mode;
      markActiveMode(newMode);
      // The background service worker reacts to this change and points the
      // toolbar button at the popup or the side panel accordingly.
      await chrome.storage.sync.set({ mode: newMode });

      if (newMode === "sidebar" && !IS_SIDEBAR) {
        // Still inside the click gesture, so opening the panel is allowed.
        try {
          const win = await chrome.windows.getCurrent();
          await chrome.sidePanel.open({ windowId: win.id });
        } catch {
          /* older browser without sidePanel.open — icon click opens it now */
        }
        window.close();
      } else if (newMode === "popup" && IS_SIDEBAR) {
        window.close();
      }
    });
  });
}

document.getElementById("refresh").addEventListener("click", analyze);

document.getElementById("history-btn").addEventListener("click", toggleHistory);

document.getElementById("history-clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ history: [] });
  showHistory();
});

const exportMenu = document.getElementById("export-menu");
document.getElementById("export").addEventListener("click", (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
});
exportMenu.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    exportMenu.hidden = true;
    downloadReport(btn.dataset.fmt);
  });
});
document.addEventListener("click", () => {
  exportMenu.hidden = true;
});

document.getElementById("copy").addEventListener("click", async () => {
  if (!reportText) return;
  const btn = document.getElementById("copy");
  try {
    await navigator.clipboard.writeText(reportText);
    btn.textContent = "✓";
  } catch {
    btn.textContent = "✗";
  }
  setTimeout(() => {
    btn.textContent = "⎘";
  }, 1200);
});

if (IS_SIDEBAR) {
  // The sidebar stays open while the user browses — follow along.
  chrome.tabs.onActivated.addListener(() => analyze());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.status === "complete") analyze();
  });
}

(async () => {
  const version = chrome.runtime?.getManifest?.().version;
  if (version) document.getElementById("version").textContent = `v${version}`;
  await loadCollapsedSections();
  setupModeSwitch();
  analyze();
})();
