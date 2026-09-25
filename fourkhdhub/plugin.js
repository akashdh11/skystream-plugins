(function () {
    "use strict";

    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    // --- Fallback Classes for Skystream Runtime ---
    const MultimediaItemClass = typeof MultimediaItem !== "undefined"
        ? MultimediaItem
        : class MultimediaItem { constructor(d) { Object.assign(this, d); } };

    const EpisodeClass = typeof Episode !== "undefined"
        ? Episode
        : class Episode { constructor(d) { Object.assign(this, d); } };

    const StreamResultClass = typeof StreamResult !== "undefined"
        ? StreamResult
        : class StreamResult {
            constructor(d) {
                this.url = d.url;
                this.source = d.source;
                this.name = d.name || d.source;
                this.quality = typeof d.quality === "number" && d.quality > 0
                    ? `${d.quality}p` : d.quality;
                this.size = d.size;
                this.headers = d.headers;
                this.type = d.type;
                this.isM3U8 = d.isM3U8 || d.type === "m3u8";
            }
        };

    const ActorClass = typeof Actor !== "undefined"
        ? Actor
        : class Actor { constructor(d) { Object.assign(this, d); } };

    const TrailerClass = typeof Trailer !== "undefined"
        ? Trailer
        : class Trailer { constructor(d) { Object.assign(this, d); } };

    // --- Configuration & Constants ---
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
    const SIMKL_CLIENT_ID = "39f470a9f2ec1aa2383269ca831bc7be0e47da48d6d708ccad9bed4e1a60993e";
    const METAHUB_LOGO_BASE = "https://live.metahub.space/logo/medium/";

    const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
    const FALLBACK_4KHDHUB = "https://4khdhub.one";
    const FALLBACK_HUBCLOUD = "https://hubcloud.ist";

    const CommonHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
    };

    const DesktopHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Ch-Ua-Mobile": "?0"
    };

    let mainUrl = (typeof manifest !== "undefined" && manifest?.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : FALLBACK_4KHDHUB;
    let hubcloudUrl = FALLBACK_HUBCLOUD;
    let domainsFetched = false;

    // 14 HomePage Categories matching decompiled CS3 FourKHDHub.java
    const HOME_CATEGORIES = [
        { path: "", title: "Home" },
        { path: "category/movies", title: "Latest Movies" },
        { path: "category/series", title: "Latest Episodes" },
        { path: "category/korean-series", title: "Korean Series" },
        { path: "category/netflix", title: "Netflix" },
        { path: "category/amazon_prime_video", title: "Amazon Prime Video" },
        { path: "category/jiohotstar", title: "JioHotstar" },
        { path: "category/disney", title: "Disney+" },
        { path: "category/Apple_TV", title: "Apple TV+" },
        { path: "category/anime", title: "Anime" },
        { path: "category/2160p-HDR", title: "4K HDR" },
        { path: "category/imdb", title: "Top IMDb" },
        { path: "category/hindi-movies", title: "Hindi Movies" },
        { path: "category/english-movies", title: "English Movies" }
    ];

    // --- Dynamic Domains Fetching ---
    async function getDomains(forceRefresh = false) {
        if (domainsFetched && !forceRefresh) {
            return { n4khdhub: mainUrl, hubcloud: hubcloudUrl };
        }
        try {
            const res = await http_get(DOMAINS_URL, CommonHeaders);
            if (res && res.body) {
                const json = JSON.parse(res.body);
                if (json["4khdhub"]) {
                    mainUrl = String(json["4khdhub"]).trim().replace(/\/+$/, "");
                }
                if (json["hubcloud"]) {
                    hubcloudUrl = String(json["hubcloud"]).trim().replace(/\/+$/, "");
                }
                domainsFetched = true;
            }
        } catch (_) {}
        return { n4khdhub: mainUrl, hubcloud: hubcloudUrl };
    }

    // --- HTML Parser (JsoupLite) ---
    class JNode {
        constructor(tag = null, attrs = {}, parent = null) {
            this.tag = tag;
            this.attrs = attrs;
            this.parent = parent;
            this.children = [];
            this.content = "";
        }
        attr(name) { return this.attrs[name.toLowerCase()] || ""; }
        textContent() {
            if (!this.tag) return this.content;
            let t = "";
            for (const c of this.children) t += c.textContent();
            return t;
        }
        text() { return this.textContent(); }
        html() { return this.children.map(c => c.outerHTML()).join(""); }
        outerHTML() {
            if (!this.tag) return this.content;
            const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
            return `<${this.tag}${attrs}>${this.html()}</${this.tag}>`;
        }
        matches(selector) {
            if (!this.tag) return false;
            selector = String(selector || "").trim();
            if (!selector) return false;

            const attrMatch = selector.match(/^([a-z0-9-_:]*)\[([a-z0-9-_:]+)(?:=(["']?)([^"'\]]+)\3)?\]$/i);
            if (attrMatch) {
                const [, tagName, attrName, , attrValue] = attrMatch;
                if (tagName && this.tag !== tagName.toLowerCase()) return false;
                const actual = this.attr(attrName.toLowerCase());
                return attrValue === undefined ? actual !== "" : actual === attrValue;
            }

            const idMatch = selector.match(/^([a-z0-9-_:]*)#([a-z0-9_-]+)$/i);
            if (idMatch) {
                const [, tagName, id] = idMatch;
                return (!tagName || this.tag === tagName.toLowerCase()) && this.attrs.id === id;
            }
            if (selector.startsWith("#")) return this.attrs.id === selector.slice(1);

            const parts = selector.split(".");
            const tagName = parts[0];
            const classes = parts.slice(1).filter(Boolean);
            if (classes.length > 0) {
                const tagMatch = !tagName || this.tag === tagName.toLowerCase();
                const nodeClasses = (this.attrs.class || "").split(/\s+/);
                return tagMatch && classes.every(c => nodeClasses.includes(c));
            }

            return this.tag === selector.toLowerCase();
        }
        collect(selector, out) {
            for (const c of this.children) {
                if (c.matches(selector)) out.push(c);
                c.collect(selector, out);
            }
        }
        selectFirst(selector) {
            const matches = this.select(selector);
            return matches[0] || null;
        }
        find(selector) { return this.selectFirst(selector); }
        select(selector, out = []) {
            selector = String(selector || "").trim();
            if (!selector) return out;
            if (selector.includes(",")) {
                const group = selector.split(",").map(s => s.trim()).filter(Boolean);
                const seen = new Set();
                group.forEach(sel => {
                    this.select(sel).forEach(node => {
                        if (!seen.has(node)) {
                            seen.add(node);
                            out.push(node);
                        }
                    });
                });
                return out;
            }
            if (selector.includes(" ")) {
                let current = [this];
                selector.split(/\s+/).forEach(part => {
                    const next = [];
                    current.forEach(node => node.collect(part, next));
                    current = next;
                });
                out.push(...current);
                return out;
            }
            for (const c of this.children) {
                if (c.matches(selector)) out.push(c);
                c.select(selector, out);
            }
            return out;
        }
        eachAttr(name) {
            return this.children.map(c => c.attr(name)).filter(Boolean);
        }
    }

    class JsoupLite {
        constructor(html) {
            this.root = new JNode("root");
            let current = this.root;
            const re = /<\/?[a-z0-9-_:]+(?:\s+[a-z0-9-_:]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+/gi;
            let m;
            while ((m = re.exec(html))) {
                const token = m[0];
                if (token.startsWith("</")) {
                    if (current.parent) current = current.parent;
                    continue;
                }
                if (token.startsWith("<")) {
                    const tagNameMatch = token.match(/^<([a-z0-9-_:]+)/i);
                    const tag = tagNameMatch ? tagNameMatch[1].toLowerCase() : "unknown";
                    const selfClosing = token.endsWith("/>") || /^(?:img|br|hr|input|meta|link)$/i.test(tag);

                    const attrs = {};
                    const attrRe = /([a-z0-9-_:]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
                    let am;
                    while ((am = attrRe.exec(token))) {
                        attrs[am[1].toLowerCase()] = am[2] || am[3] || am[4];
                    }

                    const node = new JNode(tag, attrs, current);
                    current.children.push(node);
                    if (!selfClosing) {
                        current = node;
                        if (tag === "script" || tag === "style") {
                            const endTag = `</${tag}>`;
                            const endIndex = html.indexOf(endTag, re.lastIndex);
                            if (endIndex !== -1) {
                                const content = html.substring(re.lastIndex, endIndex);
                                const t = new JNode(null, {}, current);
                                t.content = content;
                                current.children.push(t);
                                re.lastIndex = endIndex + endTag.length;
                                current = current.parent;
                            }
                        }
                    }
                    continue;
                }
                const text = token.trim();
                if (text) {
                    const t = new JNode(null, {}, current);
                    t.content = text;
                    current.children.push(t);
                }
            }
        }
        find(selector) { return this.root.find(selector); }
        selectFirst(selector) { return this.root.selectFirst(selector); }
        select(selector) { return this.root.select(selector); }
    }

    // --- String & Quality Utilities ---
    function unescapeHTML(str) {
        if (!str) return "";
        return str.replace(/&([^;]+);/g, (match, entity) => {
            const entities = {
                'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
                'nbsp': ' ', 'ndash': '–', 'mdash': '—', 'middot': '·',
                'sdot': '⋅', 'bull': '•', 'hellip': '…', 'copy': '©', 'reg': '®'
            };
            if (entities[entity]) return entities[entity];
            if (entity.startsWith('#')) {
                const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1));
                return isNaN(code) ? match : String.fromCharCode(code);
            }
            return match;
        });
    }

    function cleanText(value) {
        return unescapeHTML(String(value || ""))
            .replace(/\s+/g, " ")
            .trim();
    }

    function stripHTML(html) {
        if (!html) return "";
        return unescapeHTML(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    }

    function fixUrl(url, base = mainUrl) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return base.replace(/\/+$/, "") + url;
        return url;
    }

    function resolveUrl(url, base = mainUrl) {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("//")) return "https:" + url;
        try {
            return new URL(url, base).toString();
        } catch {
            return fixUrl(url, base);
        }
    }

    function base64Decode(str) {
        if (!str) return "";
        try {
            if (typeof atob === "function") return atob(str.trim());
            if (typeof Buffer !== "undefined") return Buffer.from(str.trim(), "base64").toString("utf-8");
        } catch (_) {}
        return "";
    }

    // ROT13 / pen implementation from decompiled UtilsKt.java
    function pen(v) {
        if (!v) return "";
        let out = "";
        for (let i = 0; i < v.length; i++) {
            const c = v[i];
            if (c >= 'A' && c <= 'Z') {
                out += String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
            } else if (c >= 'a' && c <= 'z') {
                out += String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
            } else {
                out += c;
            }
        }
        return out;
    }

    function safeScoreFrom10(score) {
        const n = Number(score);
        return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined;
    }

    function normalizeTitle(title) {
        if (!title) return "";
        return String(title).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
    }

    // Exact regex mapping for SearchQuality matching decompiled UtilsKt.java
    function getSearchQuality(tags) {
        if (!tags || tags.length === 0) return "HD";
        const normalized = tags.join(" ").normalize("NFKC").toLowerCase();

        const qualityRules = [
            { regex: /\b(4k|ds4k|uhd|2160p)\b/, quality: "4K" },
            { regex: /\b(1440p|qhd)\b/, quality: "BluRay" },
            { regex: /\b(bluray|bdrip|blu[- ]?ray)\b/, quality: "BluRay" },
            { regex: /\b(1080p|fullhd)\b/, quality: "HD" },
            { regex: /\b(720p)\b/, quality: "SD" },
            { regex: /\b(web[- ]?dl|webrip|webdl)\b/, quality: "WebRip" },
            { regex: /\b(hdrip|hdtv)\b/, quality: "HD" },
            { regex: /\b(camrip|cam[- ]?rip)\b/, quality: "CamRip" },
            { regex: /\b(hdts|hdcam|hdtc)\b/, quality: "HdCam" },
            { regex: /\b(cam)\b/, quality: "Cam" },
            { regex: /\b(dvd)\b/, quality: "DVD" },
            { regex: /\b(hq)\b/, quality: "HQ" },
            { regex: /\b(rip)\b/, quality: "CamRip" }
        ];

        for (const rule of qualityRules) {
            if (rule.regex.test(normalized)) {
                return rule.quality;
            }
        }
        return "HD";
    }

    function parseQuality(value) {
        const text = cleanText(value).toLowerCase();
        const match = text.match(/\b(2160|1440|1080|720|576|480|360)p\b/i);
        if (match) return parseInt(match[1], 10);
        if (/\b(?:4k|uhd)\b/i.test(text)) return 2160;
        return 0;
    }

    function qualityLabel(quality) {
        const q = parseInt(quality, 10);
        return q > 0 ? `${q}p` : "";
    }

    function sourceWithQuality(source, quality) {
        const q = parseInt(quality, 10);
        const qStr = qualityLabel(q);
        const s = cleanText(source) || "Direct";
        if (qStr && !s.toLowerCase().includes(qStr.toLowerCase())) {
            return `${s} ${qStr}`.trim();
        }
        return s;
    }

    // Factory: auto-converts numeric quality to string per schema (e.g. 1080 → "1080p")
    function makeStream(opts) {
        if (typeof opts.quality === "number" && opts.quality > 0) {
            opts.quality = `${opts.quality}p`;
        }
        return new StreamResultClass(opts);
    }

    // --- Parallel HTTP Fetcher ---
    async function fetchMany(requests) {
        const normalized = requests.map(req => ({
            url: req.url,
            headers: req.headers || CommonHeaders,
            meta: req.meta
        }));

        if (typeof http_parallel === "function") {
            try {
                const responses = await http_parallel(normalized.map(req => ({ url: req.url, headers: req.headers })));
                if (Array.isArray(responses) && responses.length === normalized.length) {
                    return responses.map((response, index) => ({
                        body: response?.body || "",
                        headers: response?.headers || {},
                        meta: normalized[index].meta
                    }));
                }
            } catch (_) {}
        }

        return await Promise.all(normalized.map(async req => {
            try {
                const response = await http_get(req.url, req.headers);
                return { body: response?.body || "", headers: response?.headers || {}, meta: req.meta };
            } catch (_) {
                return { body: "", headers: {}, meta: req.meta };
            }
        }));
    }

    async function httpJson(url, headers = CommonHeaders) {
        try {
            const res = await http_get(url, headers);
            if (!res || !res.body) return null;
            return JSON.parse(res.body);
        } catch (_) {
            return null;
        }
    }

    // --- TMDB Enrichment & Metadata ---
    async function fetchtmdb(title, isMovie) {
        if (!title) return null;
        const clean = cleanText(title);
        const targetType = isMovie ? "movie" : "tv";
        const inputNorm = normalizeTitle(clean);
        const url = `${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(clean)}`;

        const json = await httpJson(url);
        const results = Array.isArray(json?.results) ? json.results : [];
        let fallback = null;

        for (const item of results) {
            if (!item || item.media_type !== targetType) continue;
            const resTitle = isMovie ? item.title : item.name;
            const resNorm = normalizeTitle(resTitle);
            if (!resNorm) continue;
            if (!fallback) fallback = item.id;
            if (resNorm === inputNorm || resNorm.includes(inputNorm) || inputNorm.includes(resNorm)) {
                return item.id;
            }
        }
        return fallback;
    }

    async function fetchTmdbDetails(tmdbId, isMovie) {
        if (!tmdbId) return null;
        const type = isMovie ? "movie" : "tv";
        return await httpJson(`${TMDB_API}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=credits`);
    }

    async function fetchTmdbExternalIds(tmdbId, isMovie) {
        if (!tmdbId) return {};
        const type = isMovie ? "movie" : "tv";
        return (await httpJson(`${TMDB_API}/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`)) || {};
    }

    async function fetchSimklId(imdbId, isMovie) {
        if (!imdbId) return null;
        const type = isMovie ? "movies" : "tv";
        const url = `https://api.simkl.com/${type}/${imdbId}?client_id=${SIMKL_CLIENT_ID}`;
        const json = await httpJson(url);
        return json?.ids?.simkl || null;
    }

    function tmdbImage(path) {
        return path ? `${TMDB_IMAGE_BASE}${path}` : null;
    }

    function parseCredits(creditsJson) {
        const cast = Array.isArray(creditsJson?.cast) ? creditsJson.cast : [];
        return cast.slice(0, 20).map(c => {
            const name = cleanText(c?.name || c?.original_name);
            const role = cleanText(c?.character) || undefined;
            const image = tmdbImage(c?.profile_path) || undefined;
            if (!name) return null;
            return new ActorClass({ name, role, image });
        }).filter(Boolean);
    }

    // --- Search Result Card Parser ---
    function toSearchResult(element, base = mainUrl) {
        const titleEl = element.selectFirst("h3") || element.selectFirst(".movie-card-title");
        if (!titleEl) return null;
        const title = cleanText(titleEl.text());
        if (!title) return null;

        const href = resolveUrl(element.attr("href"), base);
        if (!href) return null;

        const img = element.selectFirst("img");
        const posterUrl = fixUrl(img?.attr("src") || img?.attr("data-src") || "", base);

        const formatTags = element.select("span.movie-card-format").map(e => cleanText(e.text())).filter(Boolean);
        const quality = getSearchQuality(formatTags);

        return new MultimediaItemClass({
            title,
            url: href,
            posterUrl,
            quality,
            type: href.includes("-series-") || href.includes("/series/") ? "series" : "movie"
        });
    }

    function parseCardsFromHtml(html, base = mainUrl) {
        const doc = new JsoupLite(html);
        return doc.select("div.card-grid a").map(card => toSearchResult(card, base)).filter(Boolean);
    }

    // --- Core Provider Functions ---

    // 1. getHome: Fetches all 14 categories in parallel and enriches Home/Trending items with TMDB
    async function getHome(cb) {
        try {
            await getDomains();

            const pages = await fetchMany(HOME_CATEGORIES.map(cat => ({
                url: `${mainUrl}/${cat.path}`.replace(/([^:]\/)\/+/g, "$1"),
                headers: CommonHeaders,
                meta: cat
            })));

            const results = {};
            pages.forEach(res => {
                const cat = res.meta;
                if (res && res.body) {
                    const parsed = parseCardsFromHtml(res.body, mainUrl);
                    if (parsed.length > 0) {
                        results[cat.title] = parsed;
                    }
                }
            });

            // Enrich Home items (Trending) with TMDB backdrop and Metahub Logo
            const homeItems = results["Home"] || [];
            const trendingCount = Math.min(8, homeItems.length);
            const trendingItems = homeItems.slice(0, trendingCount);

            await Promise.all(trendingItems.map(async item => {
                try {
                    const isMovie = item.type === "movie";
                    const tmdbId = await fetchtmdb(item.title, isMovie);
                    if (tmdbId) {
                        const [details, extIds] = await Promise.all([
                            fetchTmdbDetails(tmdbId, isMovie),
                            fetchTmdbExternalIds(tmdbId, isMovie)
                        ]);
                        if (details?.backdrop_path) {
                            item.bannerUrl = tmdbImage(details.backdrop_path);
                        }
                        if (extIds?.imdb_id) {
                            item.logoUrl = `${METAHUB_LOGO_BASE}${extIds.imdb_id}/img`;
                        }
                    }
                } catch (_) {}
            }));

            if (trendingItems.length > 0) {
                results["Trending"] = trendingItems;
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message || String(e) });
        }
    }

    // 2. search: Searches the site using /?s= and maps cards via toSearchResult
    async function search(query, cb) {
        try {
            await getDomains();
            const url = `${mainUrl}/?s=${encodeURIComponent(query)}`;
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) {
                return cb({ success: true, data: [] });
            }
            cb({ success: true, data: parseCardsFromHtml(res.body, mainUrl) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message || String(e) });
        }
    }

    // 3. load: Parses metadata, TMDB details, cast, recommendations, and episodes (with season packs)
    async function load(url, cb) {
        try {
            await getDomains();
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load page content" });
            }

            const doc = new JsoupLite(res.body);
            const rawTitle = doc.selectFirst("h1.page-title")?.text() || doc.selectFirst("h1")?.text() || "";
            const title = cleanText(rawTitle.split("(")[0]) || "Unknown";

            const ogImage = doc.selectFirst("meta[property=og:image]")?.attr("content");
            const poster = fixUrl(ogImage || "", mainUrl);

            const tags = doc.select("div.mt-2 span.badge").map(el => cleanText(el.text())).filter(Boolean);
            const yearStr = doc.selectFirst("div.mt-2 span")?.text() || "";
            const yearMatch = yearStr.match(/\b\d{4}\b/);
            const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;

            const isMovie = tags.includes("Movies");
            const trailerUrl = doc.selectFirst("#trailer-btn")?.attr("data-trailer-url") || undefined;
            const description = cleanText(doc.selectFirst("div.content-section p.mt-4")?.text() || "");

            // Recommendations
            const recommendations = doc.select("div.card-grid-small a")
                .map(card => toSearchResult(card, mainUrl))
                .filter(Boolean);

            // TMDB & Metadata enrichment
            const tmdbId = await fetchtmdb(title, isMovie).catch(() => null);
            const [tmdbDetails, externalIds] = await Promise.all([
                tmdbId ? fetchTmdbDetails(tmdbId, isMovie).catch(() => null) : null,
                tmdbId ? fetchTmdbExternalIds(tmdbId, isMovie).catch(() => ({})) : {}
            ]);

            const imdbId = externalIds?.imdb_id || "";
            const simklId = imdbId ? await fetchSimklId(imdbId, isMovie).catch(() => null) : null;
            const logoUrl = imdbId ? `${METAHUB_LOGO_BASE}${imdbId}/img` : undefined;

            const fixedTitle = cleanText(tmdbDetails?.title || tmdbDetails?.name) || title;
            const fixedPoster = tmdbImage(tmdbDetails?.poster_path) || poster;
            const fixedBackdrop = tmdbImage(tmdbDetails?.backdrop_path) || poster;
            const fixedDescription = cleanText(tmdbDetails?.overview) || description;
            const tmdbDate = tmdbDetails?.release_date || tmdbDetails?.first_air_date || "";
            const tmdbYear = tmdbDate ? parseInt(tmdbDate.split("-")[0], 10) : year;
            const score = safeScoreFrom10(tmdbDetails?.vote_average);

            const cast = tmdbDetails?.credits ? parseCredits(tmdbDetails.credits) : undefined;
            const trailers = trailerUrl ? [new TrailerClass({ url: trailerUrl })] : undefined;

            const syncData = {};
            if (tmdbId) syncData.tmdb = String(tmdbId);
            if (imdbId) syncData.imdb = imdbId;
            if (simklId) syncData.simkl = String(simklId);

            const commonData = {
                title: fixedTitle,
                url,
                posterUrl: fixedPoster,
                bannerUrl: fixedBackdrop,
                description: fixedDescription,
                year: tmdbYear,
                score,
                logoUrl,
                cast: cast && cast.length > 0 ? cast : undefined,
                trailers,
                recommendations: recommendations.length > 0 ? recommendations : undefined,
                syncData: Object.keys(syncData).length > 0 ? syncData : undefined
            };

            if (isMovie) {
                // Collect download links
                const urls = [];
                doc.select("div.download-item a").forEach(a => {
                    const href = a.attr("href");
                    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
                        const fixed = fixUrl(href, mainUrl);
                        if (!urls.includes(fixed)) urls.push(fixed);
                    }
                });

                cb({
                    success: true,
                    data: new MultimediaItemClass({
                        ...commonData,
                        type: "movie",
                        episodes: [
                            new EpisodeClass({
                                name: "Full Movie",
                                season: 1,
                                episode: 1,
                                url: JSON.stringify(urls),
                                posterUrl: fixedPoster
                            })
                        ]
                    })
                });
            } else {
                // TV Series Parsing
                const episodesMap = new Map();
                const maxEpisodePerSeason = {};

                // 1. Regular Episodes
                doc.select("div.season-item").forEach(seasonItem => {
                    const seasonText = seasonItem.selectFirst("div.episode-number")?.text() || "";
                    const sMatch = seasonText.match(/S?([1-9][0-9]*)/i);
                    const seasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;

                    seasonItem.select("div.episode-download-item").forEach(epItem => {
                        const epBadge = epItem.selectFirst("div.episode-file-info span.badge-psa")?.text() || "";
                        const epMatch = epBadge.match(/Episode-0*([1-9][0-9]*)/i);
                        if (!epMatch) return;
                        const epNum = parseInt(epMatch[1], 10);

                        const epUrls = [];
                        epItem.select("a").forEach(a => {
                            const href = a.attr("href");
                            if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
                                const fixed = fixUrl(href, mainUrl);
                                if (!epUrls.includes(fixed)) epUrls.push(fixed);
                            }
                        });

                        if (epUrls.length === 0) return;

                        const key = `${seasonNum}:${epNum}`;
                        const entry = episodesMap.get(key) || {
                            season: seasonNum,
                            episode: epNum,
                            urls: []
                        };
                        epUrls.forEach(u => { if (!entry.urls.includes(u)) entry.urls.push(u); });
                        episodesMap.set(key, entry);

                        maxEpisodePerSeason[seasonNum] = Math.max(maxEpisodePerSeason[seasonNum] || 0, epNum);
                    });
                });

                // 2. Season Packs
                const seasonPacks = [];
                doc.select("div.download-item").forEach(item => {
                    const headerText = item.selectFirst("div.flex-1.text-left.font-semibold")?.text() || "";
                    const sMatch = headerText.match(/S([0-9]+)/i);
                    if (!sMatch) return;
                    const seasonNum = parseInt(sMatch[1], 10);

                    const sizeMatch = headerText.match(/(\d+(?:\.\d+)?\s*GB)/i);
                    const size = sizeMatch ? sizeMatch[1] : "Unknown Size";

                    const qualityMatch = headerText.match(/(\d{3,4}p)/i);
                    const quality = qualityMatch ? qualityMatch[1] : "Unknown Quality";

                    const packUrls = [];
                    item.select("a").forEach(a => {
                        const href = a.attr("href");
                        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
                            const fixed = fixUrl(href, mainUrl);
                            if (!packUrls.includes(fixed)) packUrls.push(fixed);
                        }
                    });

                    if (packUrls.length === 0) return;

                    const fileTitleRaw = item.selectFirst("div.file-title")?.text() || "";
                    const cleanPackTitle = cleanText(
                        fileTitleRaw.replace(/\[[^\]]*\]/g, "").replace(/\(.*?\)/g, "")
                    );

                    const nextEp = (maxEpisodePerSeason[seasonNum] || 0) + 1;
                    maxEpisodePerSeason[seasonNum] = nextEp;

                    const padSeason = String(seasonNum).padStart(2, "0");
                    const fallbackName = `S${padSeason} – ${cleanPackTitle || "Complete Season"} [${quality}, ${size}]`;

                    seasonPacks.push({
                        season: seasonNum,
                        episode: nextEp,
                        urls: packUrls,
                        fallbackName
                    });
                });

                // 3. Parallel TMDB Season Enrichment
                const tmdbSeasonCache = {};
                if (tmdbId) {
                    const allSeasons = Array.from(new Set([
                        ...Array.from(episodesMap.values()).map(e => e.season),
                        ...seasonPacks.map(p => p.season)
                    ]));

                    const seasonResponses = await fetchMany(allSeasons.map(s => ({
                        url: `${TMDB_API}/tv/${tmdbId}/season/${s}?api_key=${TMDB_API_KEY}`,
                        headers: CommonHeaders,
                        meta: s
                    })));

                    seasonResponses.forEach(sr => {
                        try {
                            if (sr && sr.body) {
                                tmdbSeasonCache[sr.meta] = JSON.parse(sr.body);
                            }
                        } catch (_) {}
                    });
                }

                // Build final episodes array
                const episodes = [];

                for (const item of episodesMap.values()) {
                    const seasonJson = tmdbSeasonCache[item.season];
                    const tmdbEp = Array.isArray(seasonJson?.episodes)
                        ? seasonJson.episodes.find(e => Number(e?.episode_number) === Number(item.episode))
                        : null;

                    episodes.push(new EpisodeClass({
                        name: cleanText(tmdbEp?.name) || `Episode ${item.episode}`,
                        season: item.season,
                        episode: item.episode,
                        url: JSON.stringify(item.urls),
                        posterUrl: tmdbImage(tmdbEp?.still_path) || fixedPoster,
                        description: cleanText(tmdbEp?.overview) || undefined,
                        airDate: tmdbEp?.air_date || undefined,
                        rating: safeScoreFrom10(tmdbEp?.vote_average)
                    }));
                }

                for (const pack of seasonPacks) {
                    const seasonJson = tmdbSeasonCache[pack.season];
                    const tmdbEp = Array.isArray(seasonJson?.episodes)
                        ? seasonJson.episodes.find(e => Number(e?.episode_number) === Number(pack.episode))
                        : null;

                    episodes.push(new EpisodeClass({
                        name: cleanText(tmdbEp?.name) || pack.fallbackName,
                        season: pack.season,
                        episode: pack.episode,
                        url: JSON.stringify(pack.urls),
                        posterUrl: tmdbImage(tmdbEp?.still_path) || fixedPoster,
                        description: cleanText(tmdbEp?.overview) || undefined,
                        airDate: tmdbEp?.air_date || undefined,
                        rating: safeScoreFrom10(tmdbEp?.vote_average)
                    }));
                }

                episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

                cb({
                    success: true,
                    data: new MultimediaItemClass({
                        ...commonData,
                        type: "series",
                        episodes
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message || String(e) });
        }
    }

    // --- Extractors Implementation ---

    // 1. getRedirectLinks: multi-stage ROT13/pen decode from UtilsKt.java
    async function getRedirectLinks(url) {
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return "";

            let combined = "";
            const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let match;
            while ((match = regex.exec(res.body)) !== null) {
                combined += (match[1] || match[2] || "");
            }
            if (!combined) return "";

            const rawDecoded = base64Decode(combined);
            const pDecoded = pen(base64Decode(rawDecoded));
            const jsonStr = base64Decode(pDecoded);
            const decoded = JSON.parse(jsonStr);

            if (decoded.o) {
                const target = base64Decode(decoded.o).trim();
                if (target) return target;
            }

            if (decoded.blog_url && decoded.data) {
                const data = base64Decode(decoded.data);
                const blogRes = await http_get(`${decoded.blog_url}?re=${data}`, CommonHeaders);
                if (blogRes && blogRes.body) {
                    return stripHTML(blogRes.body);
                }
            }
            return "";
        } catch (_) {
            return "";
        }
    }

    // 2. resolveFinalUrl: uses fetch with redirect:"manual" to walk each redirect hop
    //    (http_get uses axios which auto-follows and does NOT expose finalUrl)
    async function resolveFinalUrl(startUrl, maxRedirects = 8) {
        let currentUrl = String(startUrl || "").trim();
        for (let i = 0; i < maxRedirects; i++) {
            // Check if current URL already contains dl.php?link=
            const dlCheck = currentUrl.match(/dl\.php\?link=([^&]+)/i);
            if (dlCheck) {
                try { return decodeURIComponent(dlCheck[1]); }
                catch (_) { return dlCheck[1]; }
            }

            try {
                const res = await fetch(currentUrl, {
                    method: "GET",
                    headers: { ...CommonHeaders, "Referer": currentUrl },
                    redirect: "manual"
                });

                const loc = res.headers.get("location") ||
                            res.headers.get("hx-redirect");
                if (loc && loc.trim()) {
                    try { currentUrl = new URL(loc.trim(), currentUrl).toString(); }
                    catch (_) { currentUrl = loc.trim(); }
                    continue;
                }

                // No redirect header — read body for embedded links
                const body = await res.text();
                const bodyDlMatch = body.match(/dl\.php\?link=([^"'\s&<>]+)/i);
                if (bodyDlMatch) {
                    try { return decodeURIComponent(bodyDlMatch[1]); }
                    catch (_) { return bodyDlMatch[1]; }
                }
                const videoMatch = body.match(/https?:\/\/video-downloads\.googleusercontent\.com\/[^\s"'<>]+/i);
                if (videoMatch) return videoMatch[0];

                // fetch redirect:"manual" won't populate res.url on 3xx,
                // but on 200 it may differ from currentUrl
                if (res.url && res.url !== currentUrl) {
                    const urlDl = res.url.match(/dl\.php\?link=([^&]+)/i);
                    if (urlDl) {
                        try { return decodeURIComponent(urlDl[1]); }
                        catch (_) { return urlDl[1]; }
                    }
                    currentUrl = res.url;
                }
                break;
            } catch (_) {
                break;
            }
        }

        // Final extraction attempt on whatever URL we ended up with
        const finalDl = currentUrl.match(/dl\.php\?link=([^&]+)/i);
        if (finalDl) {
            try { return decodeURIComponent(finalDl[1]); }
            catch (_) { return finalDl[1]; }
        }
        return currentUrl;
    }

    // Clean title and quality detection for HubCloud headers
    function cleanTitle(header) {
        if (!header) return "";
        const tags = ["WEB-DL", "DDP5.1", "ATMOS", "DOLBYVISION", "H265", "HDR", "HDR10+", "HEVC"];
        return tags.filter(tag => header.toUpperCase().includes(tag)).join(" ");
    }

    function getIndexQuality(str) {
        const text = String(str || "").toLowerCase();
        if (text.includes("4k") || text.includes("2160p")) return 2160;
        if (text.includes("1080p")) return 1080;
        if (text.includes("720p")) return 720;
        if (text.includes("480p")) return 480;
        return 1080;
    }

    function parseDynamicHrefMap(html, base) {
        const map = {};
        const varMap = {};
        const varRegex = /(?:var|let|const)\s+([a-zA-Z0-9_$]+)\s*=\s*['"]([^'"]+)['"]/gi;
        let vMatch;
        while ((vMatch = varRegex.exec(html)) !== null) {
            varMap[vMatch[1]] = resolveUrl(vMatch[2], base);
            map[vMatch[1]] = varMap[vMatch[1]];
        }

        const idRegex = /document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)\.href\s*=\s*([^;]+)/gi;
        let idMatch;
        while ((idMatch = idRegex.exec(html)) !== null) {
            const elId = idMatch[1];
            let val = idMatch[2].trim().replace(/^['"]|['"]$/g, "");
            if (varMap[val]) {
                map[elId] = varMap[val];
            } else if (/^https?:\/\//i.test(val)) {
                map[elId] = resolveUrl(val, base);
            }
        }

        const jqRegex = /\$\(\s*['"]#([^'"]+)['"]\s*\)\.attr\(\s*['"]href['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi;
        let jqMatch;
        while ((jqMatch = jqRegex.exec(html)) !== null) {
            map[jqMatch[1]] = resolveUrl(jqMatch[2], base);
        }

        const pxlVar = html.match(/(?:var|let|const)?\s*pxl\w*\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
        if (pxlVar && pxlVar[1] && !/negn6f/i.test(pxlVar[1])) {
            map["_pxl"] = resolveUrl(pxlVar[1], base);
            map["pxl-1"] = map["_pxl"];
        }

        const allPxl = html.match(/https?:\/\/pixeldrain\.[a-z]+\/u\/[a-zA-Z0-9]+/gi) || [];
        for (const p of allPxl) {
            if (!/negn6f/i.test(p)) {
                if (!map["_pxl"]) map["_pxl"] = p;
                if (!map["pxl-1"]) map["pxl-1"] = p;
                break;
            }
        }

        return map;
    }

    // 3. extractHubCloud: HubCloud extractor ported from HubCloud.java
    async function extractHubCloud(url, sourcePrefix = "HubCloud", qualityHint = 0) {
        const results = [];
        try {
            await getDomains();
            let currentUrl = String(url || "").trim();

            // Dynamic domain replacement
            if (hubcloudUrl) {
                currentUrl = currentUrl.replace(/https?:\/\/hubcloud\.[a-z0-9]+/i, hubcloudUrl);
            }

            const headers = { ...CommonHeaders, "Cookie": "xla=s4t", "Referer": currentUrl };
            let res = await http_get(currentUrl, headers);
            if (!res || !res.body) return results;

            let pageHtml = res.body;
            let baseUrl = currentUrl;

            // If not landing on hubcloud.php, follow to the actual download page
            if (!currentUrl.includes("hubcloud.php")) {
                const doc = new JsoupLite(pageHtml);
                let nextHref = doc.selectFirst("#download")?.attr("href") || "";
                if (!nextHref) {
                    const match = pageHtml.match(/var\s+url\s*=\s*'([^']*)'/i) ||
                                  pageHtml.match(/href="([^"]*hubcloud\.php[^"]*)"/i);
                    if (match) nextHref = match[1];
                }
                if (nextHref) {
                    baseUrl = resolveUrl(nextHref, currentUrl);
                    const res2 = await http_get(baseUrl, { ...headers, "Referer": currentUrl });
                    if (res2 && res2.body) {
                        pageHtml = res2.body;
                    }
                }
            }

            const doc = new JsoupLite(pageHtml);
            const dynamicMap = parseDynamicHrefMap(pageHtml, baseUrl);

            const headerEl = doc.selectFirst(".card-header") || doc.selectFirst("h1");
            const header = cleanText(headerEl?.text() || "");
            const headerDetails = cleanTitle(header);
            const rawSize = cleanText(doc.selectFirst("#size")?.text() || "");
            const cleanSize = rawSize ? `[${rawSize}]` : "";
            const labelExtras = `${headerDetails ? `[${headerDetails}]` : ""} ${cleanSize}`.trim();
            const quality = qualityHint || getIndexQuality(header) || parseQuality(pageHtml) || 1080;

            const buttons = doc.select("a.btn, a.btn-lg, a.btn-primary, a.btn-success, a.btn-danger, a");
            const seenUrls = new Set();

            for (const btn of buttons) {
                const id = btn.attr("id");
                let link = resolveUrl(dynamicMap[id] || btn.attr("href"), baseUrl);
                const text = cleanText(btn.text());
                const lower = text.toLowerCase();

                if (!link || /telegram|facebook|twitter|tinyurl|tutorial|login|logout/i.test(`${link} ${lower}`)) {
                    continue;
                }

                if (lower.includes("fsl server")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [FSL Server]`,
                        name: `${sourcePrefix} [FSL Server] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("instant download") || lower.includes("instant") || lower.includes("download file")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [Instant Download]`,
                        name: `${sourcePrefix} [Instant Download] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("buzzserver") || lower.includes("buzz server") || lower.includes("buzz") || lower.includes("fuckingfast")) {
                    try {
                        const buzzRes = await http_get(link, { ...DesktopHeaders, "Referer": baseUrl });
                        if (buzzRes && buzzRes.body) {
                            const buzzDoc = new JsoupLite(buzzRes.body);
                            let dlPath = buzzDoc.selectFirst("a[hx-get*='download']")?.attr("hx-get") || "";
                            if (!dlPath) {
                                const dlMatch = buzzRes.body.match(/copyDownloadLink\(['"]([^'"]+)['"]\)/i);
                                if (dlMatch) dlPath = dlMatch[1];
                            }
                            const dlUrl = dlPath ? resolveUrl(dlPath, link) : `${link.replace(/\/+$/, "")}/download`;
                            const dlRes = await http_get(dlUrl, {
                                ...DesktopHeaders,
                                "Referer": link,
                                "HX-Request": "true"
                            });
                            const redir = dlRes?.headers?.["hx-redirect"] || dlRes?.headers?.["HX-Redirect"] ||
                                          dlRes?.headers?.["location"] || dlRes?.headers?.["Location"];
                            if (redir) {
                                const finalBuzzUrl = resolveUrl(redir, link);
                                results.push(makeStream({
                                    source: `${sourcePrefix} [BuzzServer]`,
                                    name: `${sourcePrefix} [BuzzServer] ${labelExtras}`.trim(),
                                    url: finalBuzzUrl,
                                    quality,
                                    size: rawSize || undefined
                                }));
                            }
                        }
                    } catch (_) {}
                } else if (lower.includes("pixeldra") || lower.includes("pixelserver") || lower.includes("pixel server") || lower.includes("pixeldrain")) {
                    let pxlLink = link;
                    if (/negn6f/i.test(pxlLink) || (!/\/u\//.test(pxlLink) && !/\/api\//.test(pxlLink))) {
                        if (id && dynamicMap[id] && !/negn6f/i.test(dynamicMap[id])) {
                            pxlLink = dynamicMap[id];
                        } else if (dynamicMap["pxl-1"] && !/negn6f/i.test(dynamicMap["pxl-1"])) {
                            pxlLink = dynamicMap["pxl-1"];
                        } else if (dynamicMap["_pxl"] && !/negn6f/i.test(dynamicMap["_pxl"])) {
                            pxlLink = dynamicMap["_pxl"];
                        }
                    }

                    let fileId = "";
                    const m1 = pxlLink.match(/\/u\/([a-zA-Z0-9]+)/i) || pxlLink.match(/file\/([a-zA-Z0-9]+)/i);
                    if (m1 && !/negn6f/i.test(m1[1])) {
                        fileId = m1[1];
                    }
                    if (!fileId && dynamicMap["_pxl"]) {
                        const m2 = dynamicMap["_pxl"].match(/\/u\/([a-zA-Z0-9]+)/i);
                        if (m2 && !/negn6f/i.test(m2[1])) fileId = m2[1];
                    }

                    if (fileId && !/negn6f/i.test(fileId)) {
                        results.push(makeStream({
                            source: `${sourcePrefix} [Pixeldrain]`,
                            name: `${sourcePrefix} [Pixeldrain] ${labelExtras}`.trim(),
                            url: `https://pixeldrain.dev/api/file/${fileId}?download`,
                            quality,
                            size: rawSize || undefined
                        }));
                    }
                } else if (lower.includes("s3 server")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [S3 Server]`,
                        name: `${sourcePrefix} [S3 Server] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("fslv2")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [FSLv2]`,
                        name: `${sourcePrefix} [FSLv2] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("mega server")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [Mega Server]`,
                        name: `${sourcePrefix} [Mega Server] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("pdl server")) {
                    results.push(makeStream({
                        source: `${sourcePrefix} [PDL Server]`,
                        name: `${sourcePrefix} [PDL Server] ${labelExtras}`.trim(),
                        url: link,
                        quality,
                        size: rawSize || undefined
                    }));
                } else if (lower.includes("10gbps")) {
                    try {
                        const finalUrl = await resolveFinalUrl(link);
                        results.push(makeStream({
                            source: `${sourcePrefix} 10Gbps [Download]`,
                            name: `${sourcePrefix} 10Gbps [Download] ${labelExtras}`.trim(),
                            url: finalUrl || link,
                            quality,
                            size: rawSize || undefined
                        }));
                    } catch (_) {
                        results.push(makeStream({
                            source: `${sourcePrefix} 10Gbps [Download]`,
                            name: `${sourcePrefix} 10Gbps [Download] ${labelExtras}`.trim(),
                            url: link,
                            quality,
                            size: rawSize || undefined
                        }));
                    }
                } else if (/pixeldrain|hubcdn|hubdrive|hblinks/i.test(link)) {
                    try {
                        const extra = await loadExtractor(link, sourcePrefix, quality);
                        results.push(...extra);
                    } catch (_) {}
                }
            }
        } catch (_) {}
        return results;
    }

    // 4. extractHUBCDN: HUBCDN extractor from HUBCDN.java
    async function extractHUBCDN(url) {
        const results = [];
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return results;

            const match = res.body.match(/reurl\s*=\s*"([^"]+)"/i);
            if (match && match[1]) {
                const encoded = match[1].includes("?r=")
                    ? match[1].substring(match[1].indexOf("?r=") + 3)
                    : match[1];
                const decoded = base64Decode(encoded);
                const streamUrl = decoded.includes("link=")
                    ? decoded.substring(decoded.lastIndexOf("link=") + 5)
                    : decoded;

                if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
                    results.push(makeStream({
                        source: "HUBCDN",
                        name: "HUBCDN",
                        url: streamUrl,
                        quality: parseQuality(streamUrl) || 1080
                    }));
                }
            }
        } catch (_) {}
        return results;
    }

    // 5. extractHubcdnn: Hubcdnn extractor from Hubcdnn.java
    async function extractHubcdnn(url) {
        const results = [];
        try {
            const res = await http_get(url, { ...CommonHeaders, "Referer": url });
            if (!res || !res.body) return results;

            const match = res.body.match(/r=([A-Za-z0-9+/=]+)/i);
            if (match && match[1]) {
                const decoded = base64Decode(match[1]);
                const streamUrl = decoded.includes("link=")
                    ? decoded.substring(decoded.lastIndexOf("link=") + 5)
                    : decoded;

                if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
                    results.push(makeStream({
                        source: "Hubcdn",
                        name: "Hubcdn",
                        url: streamUrl,
                        type: "m3u8",
                        isM3U8: true,
                        headers: { "Referer": url },
                        quality: parseQuality(streamUrl) || 1080
                    }));
                }
            }
        } catch (_) {}
        return results;
    }

    // 6. extractHubDrive: Hubdrive extractor from Hubdrive.java
    async function extractHubDrive(url, sourcePrefix = "HubDrive", qualityHint = 0) {
        const results = [];
        try {
            const res = await http_get(url, { ...CommonHeaders, "Cookie": "xla=s4t", "Referer": url });
            if (!res || !res.body) return results;

            let btnHref = "";
            const doc = new JsoupLite(res.body);
            const btn = doc.selectFirst(".btn-success1") ||
                        doc.selectFirst("a[href*='hubcloud']") ||
                        doc.selectFirst(".btn.btn-primary.btn-user.btn-success1.m-1");
            if (btn) btnHref = btn.attr("href") || "";
            if (!btnHref) {
                const m = res.body.match(/class="[^"]*btn-success1[^"]*"[^>]*href="([^"]+)"/i) ||
                          res.body.match(/href="([^"]*hubcloud[^"]*)"/i);
                if (m) btnHref = m[1];
            }

            if (btnHref) {
                const targetUrl = resolveUrl(btnHref, url);
                if (targetUrl.includes("hubcloud")) {
                    const hcStreams = await extractHubCloud(targetUrl, sourcePrefix, qualityHint);
                    results.push(...hcStreams);
                } else {
                    const delegated = await loadExtractor(targetUrl, sourcePrefix, qualityHint);
                    results.push(...delegated);
                }
            }
        } catch (_) {}
        return results;
    }

    // 7. extractHblinks: Hblinks extractor from Hblinks.java
    async function extractHblinks(url, sourcePrefix = "Hblinks", qualityHint = 0) {
        const results = [];
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return results;

            const doc = new JsoupLite(res.body);
            const links = doc.select("h3 a, h5 a, div.entry-content p a");

            for (const a of links) {
                const href = a.attr("href") || a.attr("abs:href");
                if (!href) continue;
                const lower = href.toLowerCase();

                if (lower.includes("hubdrive")) {
                    const r = await extractHubDrive(href, sourcePrefix, qualityHint);
                    results.push(...r);
                } else if (lower.includes("hubcloud")) {
                    const r = await extractHubCloud(href, sourcePrefix, qualityHint);
                    results.push(...r);
                } else if (lower.includes("hubcdn")) {
                    const r = await extractHUBCDN(href);
                    results.push(...r);
                } else {
                    const r = await loadExtractor(href, sourcePrefix, qualityHint);
                    results.push(...r);
                }
            }
        } catch (_) {}
        return results;
    }

    // 8. extractPixelDrain: PixelDrain extractor from PixelDrainDev.java
    async function extractPixelDrain(url, qualityHint = 0) {
        const results = [];
        const m = url.match(/\/(?:u|file)\/([a-zA-Z0-9]+)/i);
        if (m) {
            results.push(makeStream({
                source: "PixelDrain",
                name: "PixelDrain",
                url: `https://pixeldrain.dev/api/file/${m[1]}?download`,
                quality: qualityHint || parseQuality(url) || 1080
            }));
        }
        return results;
    }

    // Extractor Dispatcher
    async function loadExtractor(url, sourcePrefix = "Auto", qualityHint = 0) {
        const u = String(url || "").trim();
        const lower = u.toLowerCase();

        if (lower.includes("pixel.hubcloud")) {
            try {
                const finalUrl = await resolveFinalUrl(u);
                return [makeStream({
                    source: `${sourcePrefix} 10Gbps [Download]`,
                    name: `${sourcePrefix} 10Gbps [Download]`,
                    url: finalUrl || u,
                    quality: qualityHint || parseQuality(u) || 1080
                })];
            } catch (_) {
                return [makeStream({
                    source: `${sourcePrefix} 10Gbps [Download]`,
                    name: `${sourcePrefix} 10Gbps [Download]`,
                    url: u,
                    quality: qualityHint || parseQuality(u) || 1080
                })];
            }
        }
        if (lower.includes("hubcloud")) {
            return await extractHubCloud(u, sourcePrefix, qualityHint);
        }
        if (lower.includes("hubdrive")) {
            return await extractHubDrive(u, sourcePrefix, qualityHint);
        }
        if (lower.includes("hblinks") || lower.includes("hubstream.dad")) {
            return await extractHblinks(u, sourcePrefix, qualityHint);
        }
        if (lower.includes("hubcdn")) {
            const res1 = await extractHUBCDN(u);
            if (res1.length > 0) return res1;
            return await extractHubcdnn(u);
        }
        if (lower.includes("pixeldrain")) {
            return await extractPixelDrain(u, qualityHint);
        }

        // Direct Stream Fallback
        return [makeStream({
            source: sourceWithQuality(sourcePrefix, qualityHint),
            name: `${sourcePrefix} [Direct]`,
            url: u,
            quality: qualityHint || parseQuality(u) || 1080
        })];
    }

    // Safely extract URLs from any string, escaped string, JSON array or object
    function extractInputUrls(input) {
        if (!input) return [];
        if (Array.isArray(input)) {
            return input.flatMap(extractInputUrls);
        }
        if (typeof input === "object") {
            const list = [];
            if (input.url) list.push(...extractInputUrls(input.url));
            if (Array.isArray(input.links)) list.push(...extractInputUrls(input.links));
            return list;
        }
        const str = String(input || "").trim();
        if (!str) return [];

        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed) || typeof parsed === "object") {
                return extractInputUrls(parsed);
            }
        } catch (_) {}

        try {
            const cleaned = str.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed) || typeof parsed === "object") {
                return extractInputUrls(parsed);
            }
        } catch (_) {}

        const matched = str.match(/https?:\/\/[^\s"',\]\\]+/g);
        if (matched && matched.length > 0) {
            return matched;
        }

        return [str];
    }

    // 4. loadStreams: Skystream stream loading function
    async function loadStreams(url, cb) {
        try {
            const urls = [...new Set(extractInputUrls(url).filter(Boolean))];
            if (urls.length === 0) {
                return cb({ success: true, data: [] });
            }

            const allStreams = [];
            const seenStreamUrls = new Set();

            await Promise.all(urls.map(async rawUrl => {
                try {
                    let resolvedUrl = rawUrl;
                    if (rawUrl.includes("id=")) {
                        resolvedUrl = await getRedirectLinks(rawUrl);
                    }
                    if (!resolvedUrl || !resolvedUrl.trim()) return;

                    const streams = await loadExtractor(resolvedUrl, "4K HD");
                    streams.forEach(s => {
                        if (s && s.url && !seenStreamUrls.has(s.url)) {
                            seenStreamUrls.add(s.url);
                            allStreams.push(s);
                        }
                    });
                } catch (_) {}
            }));

            allStreams.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
            cb({ success: true, data: allStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
        }
    }

    // --- Export to Skystream Runtime ---
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
