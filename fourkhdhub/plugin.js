(function() {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    class JNode {
        constructor(tag = null, attrs = {}, parent = null) {
            this.tag = tag;
            this.attrs = attrs;
            this.parent = parent;
            this.children = [];
            this.text = "";
        }
        attr(name) { return this.attrs[name] || ""; }
        textContent() {
            if (!this.tag) return this.text;
            let t = "";
            for (const c of this.children) t += c.textContent();
            return t;
        }
        html() { return this.children.map(c => c.outerHTML()).join(""); }
        outerHTML() {
            if (!this.tag) return this.text;
            const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
            return `<${this.tag}${attrs}>${this.html()}</${this.tag}>`;
        }
        matches(selector) {
            if (!this.tag) return false;
            selector = String(selector || "").trim();
            if (!selector) return false;

            const attrMatch = selector.match(/^([a-z0-9-]*)\[([a-z0-9-]+)(?:=(["']?)([^"'\]]+)\3)?\]$/i);
            if (attrMatch) {
                const [, tagName, attrName, , attrValue] = attrMatch;
                if (tagName && this.tag !== tagName.toLowerCase()) return false;
                const actual = this.attr(attrName.toLowerCase());
                return attrValue === undefined ? actual !== "" : actual === attrValue;
            }

            const idMatch = selector.match(/^([a-z0-9-]*)#([a-z0-9_-]+)$/i);
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
    }

    class JsoupLite {
        constructor(html) {
            this.root = new JNode("root");
            let current = this.root;
            const re = /<\/?[a-z0-9]+(?:\s+[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+/gi;
            let m;
            while ((m = re.exec(html))) {
                const token = m[0];
                if (token.startsWith("</")) {
                    if (current.parent) current = current.parent;
                    continue;
                }
                if (token.startsWith("<")) {
                    const tagNameMatch = token.match(/^<([a-z0-9]+)/i);
                    const tag = tagNameMatch ? tagNameMatch[1].toLowerCase() : "unknown";
                    const selfClosing = token.endsWith("/>") || /^(?:img|br|hr|input|meta|link)$/i.test(tag);
                    
                    const attrs = {};
                    const attrRe = /([a-z0-9-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
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
                                t.text = content;
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
                    t.text = text;
                    current.children.push(t);
                }
            }
        }
        find(selector) { return this.root.find(selector); }
        select(selector) { return this.root.select(selector); }
    }

    const CommonHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36" };
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

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

    function stripHTML(html) {
        if (!html) return "";
        return unescapeHTML(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    }

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return manifest.baseUrl + url;
        return url;
    }

    function resolveUrl(url, base) {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("//")) return "https:" + url;
        try {
            return new URL(url, base || manifest.baseUrl).toString();
        } catch {
            return fixUrl(url);
        }
    }

    function cleanText(value) {
        return unescapeHTML(String(value || ""))
            .replace(/\s+/g, " ")
            .trim();
    }

    function isStreamHost(url, text = "") {
        const value = String(url || "").toLowerCase();
        const t = String(text || "").toLowerCase();
        if (!value || value.startsWith("#") || value.startsWith("javascript:")) return false;
        if (/telegram|facebook|twitter|instagram|youtube|tutorial|snvhost|snaptube|winx|winexch|tinyurl|snacklink/i.test(value)) return false;

        // Check known stream domains and redirect formats
        if (value.includes("gadgetsweb") || value.includes("greenmotors") || value.includes("hubcloud") || value.includes("hubdrive") || value.includes("hubcdn") || value.includes("drive.google.com")) return true;
        if (value.includes("?id=") || value.includes("&id=")) return true;

        // Check anchor text / context
        if (/hubcloud|hubdrive|hubcdn|gdrive|download|stream|server|direct|fsl|pixeldrain/i.test(t)) return true;

        return false;
    }

    function detectSourceName(url, fallback = "Auto") {
        const value = String(url || "").toLowerCase();
        if (value.includes("hubcloud")) return "HubCloud";
        if (value.includes("hubdrive")) return "HubDrive";
        if (value.includes("hubcdn")) return "HubCDN";
        if (value.includes("drive.google.com")) return "GDrive";
        if (value.includes("gadgetsweb") || value.includes("greenmotors") || value.includes("id=")) return fallback;
        return fallback;
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

    function normalizeSourceName(value) {
        return cleanText(value)
            .replace(/download/ig, "")
            .replace(/[\[\]]/g, "")
            .replace(/&nbsp;/ig, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function sourceWithQuality(source, quality) {
        const label = normalizeSourceName(source) || "Auto";
        const qLabel = qualityLabel(quality);
        if (!qLabel) return label;

        const cleanLabel = label
            .replace(/\b(?:2160|1440|1080|720|576|480|360)p\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();

        return `${cleanLabel || label} ${qLabel}`.trim();
    }

    function parseSeasonNumber(value) {
        const text = cleanText(value);
        return parseInt(text.match(/\bS(?:eason)?\s*0*(\d+)/i)?.[1] || text.match(/\bSeason\s*0*(\d+)/i)?.[1] || "", 10) || 0;
    }

    function parseEpisodeNumber(value) {
        const text = cleanText(value);
        return parseInt(
            text.match(/\bS\d+\s*E0*(\d+)/i)?.[1]
            || text.match(/\bEpisode[-\s]*0*(\d+)/i)?.[1]
            || text.match(/\bE0*(\d+)\b/i)?.[1]
            || "",
            10
        ) || 0;
    }

    function findAncestor(node, selector) {
        let current = node;
        while (current) {
            if (current.matches && current.matches(selector)) return current;
            current = current.parent;
        }
        return null;
    }

    function linkFromAnchor(anchor, context) {
        const href = fixUrl(anchor.attr("href"));
        const rawText = anchor.textContent() || "";
        if (!href || !isStreamHost(href, rawText)) return null;

        const rawName = normalizeSourceName(rawText) || detectSourceName(href);
        const quality = parseQuality(`${context || ""} ${rawName} ${href}`);
        const source = sourceWithQuality(detectSourceName(href, rawName), quality);

        return {
            name: source,
            source,
            url: href,
            quality: quality || undefined
        };
    }

    function extractNodeLinks(node, context) {
        const links = [];
        const seen = new Set();
        node.select("a").forEach(anchor => {
            const link = linkFromAnchor(anchor, context);
            if (!link || seen.has(link.url)) return;
            seen.add(link.url);
            links.push(link);
        });
        return links;
    }

    function addDistinctLinks(target, links) {
        const seen = new Set(target.map(link => link.url));
        links.forEach(link => {
            if (link.url && !seen.has(link.url)) {
                seen.add(link.url);
                target.push(link);
            }
        });
    }

    function selectMany(doc, selectors) {
        const out = [];
        const seen = new Set();
        selectors.forEach(selector => {
            doc.select(selector).forEach(node => {
                if (seen.has(node)) return;
                seen.add(node);
                out.push(node);
            });
        });
        return out;
    }

    function parseDynamicHrefMap(html, base) {
        const map = {};
        const patterns = [
            /\$\(\s*['"]#([^'"]+)['"]\s*\)\.attr\(\s*['"]href['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
            /document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)\.href\s*=\s*['"]([^'"]+)['"]/gi
        ];
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                map[match[1]] = resolveUrl(match[2], base);
            }
        });
        return map;
    }

    function compareEpisodes(a, b) {
        if ((a.season || 0) !== (b.season || 0)) return (a.season || 0) - (b.season || 0);
        if ((a.episode || 0) !== (b.episode || 0)) return (a.episode || 0) - (b.episode || 0);
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
    }

    function normalizeTitle(value) {
        return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    async function fetchMany(requests) {
        const normalized = requests.map(req => ({
            url: req.url,
            headers: req.headers || CommonHeaders,
            meta: req.meta
        }));

        if (typeof http_parallel === "function") {
            try {
                const responses = await http_parallel(normalized.map(req => ({ url: req.url, headers: req.headers })));
                if (Array.isArray(responses)) {
                    return responses.map((response, index) => ({ ...(response || {}), meta: normalized[index].meta }));
                }
            } catch {}
        }

        return await Promise.all(normalized.map(async req => {
            try {
                const response = await http_get(req.url, req.headers);
                return { ...(response || {}), meta: req.meta };
            } catch {
                return { body: "", meta: req.meta };
            }
        }));
    }

    async function httpJson(url) {
        const res = await http_get(url, CommonHeaders);
        if (!res || !res.body) return null;
        try {
            return JSON.parse(res.body);
        } catch {
            return null;
        }
    }

    async function fetchTmdbId(title, isMovie) {
        const json = await httpJson(`${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanText(title))}`);
        const results = Array.isArray(json?.results) ? json.results : [];
        const targetType = isMovie ? "movie" : "tv";
        const inputNorm = normalizeTitle(title);
        let fallback = null;

        for (const item of results) {
            if (!item || item.media_type !== targetType) continue;
            const resultTitle = isMovie ? item.title : item.name;
            const resultNorm = normalizeTitle(resultTitle);
            if (!resultNorm) continue;
            if (!fallback) fallback = item.id;
            if (resultNorm === inputNorm || resultNorm.includes(inputNorm) || inputNorm.includes(resultNorm)) return item.id;
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
        return await httpJson(`${TMDB_API}/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`) || {};
    }

    async function fetchTmdbSeason(tmdbId, season) {
        if (!tmdbId || !season) return null;
        return await httpJson(`${TMDB_API}/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`);
    }

    function tmdbImage(path) {
        return path ? `${TMDB_IMAGE_BASE}${path}` : null;
    }

    function safeScore(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }

    function makeActor(name, role, image) {
        if (!name) return null;
        try {
            if (typeof Actor !== "undefined") return new Actor({ name, role, image });
        } catch {}
        return { name, role, image };
    }

    function parseTmdbCast(tmdbDetails, limit = 20) {
        const cast = Array.isArray(tmdbDetails?.credits?.cast) ? tmdbDetails.credits.cast : [];
        return cast.slice(0, limit).map(c => makeActor(
            cleanText(c?.name || c?.original_name),
            cleanText(c?.character),
            tmdbImage(c?.profile_path)
        )).filter(Boolean);
    }

    function makeTrailer(url) {
        if (!url) return null;
        try {
            if (typeof Trailer !== "undefined") return new Trailer({ url });
        } catch {}
        return { url };
    }

    function parseRecommendations(doc) {
        return doc.select("div.card-grid-small a").map(card => {
            const title = cleanText(card.find("h3")?.textContent() || card.find(".movie-card-title")?.textContent());
            const href = fixUrl(card.attr("href"));
            const img = card.find("img");
            const posterUrl = fixUrl(img?.attr("data-src") || img?.attr("src") || "");
            if (!title || !href) return null;
            return new MultimediaItem({
                title,
                url: href,
                posterUrl,
                type: href.includes("-series-") || href.includes("/series/") ? "series" : "movie"
            });
        }).filter(Boolean);
    }

    function readMeta(doc, key, value) {
        const meta = doc.select("meta").find(m => m.attr(key) === value);
        return meta?.attr("content") || "";
    }

    function buildSyncData(tmdbId, imdbId) {
        const syncData = {};
        if (tmdbId) syncData.tmdb = String(tmdbId);
        if (imdbId) syncData.imdb = imdbId;
        return Object.keys(syncData).length ? syncData : undefined;
    }

    function getTmdbEpisodeInfo(seasonJson, episodeNumber) {
        const episodes = Array.isArray(seasonJson?.episodes) ? seasonJson.episodes : [];
        const ep = episodes.find(item => Number(item?.episode_number) === Number(episodeNumber));
        if (!ep) return {};
        return {
            name: cleanText(ep.name),
            description: cleanText(ep.overview),
            posterUrl: tmdbImage(ep.still_path),
            airDate: ep.air_date || undefined,
            rating: safeScore(ep.vote_average)
        };
    }

    function parseRes(html) {
        const doc = new JsoupLite(html);
        const items = [];
        const filmBlocks = doc.select("a.movie-card");
        console.log(`Found ${filmBlocks.length} movie cards`);
        filmBlocks.forEach(card => {
            const titleEl = card.find(".movie-card-title") || card.find("h3");
            const title = titleEl?.textContent().trim() || "Unknown Title";
            const url = fixUrl(card.attr("href"));
            let poster = "";
            const img = card.find("img");
            if (img) poster = img.attr("data-src") || img.attr("src") || "";
            poster = fixUrl(poster);
            
            const type = url.includes("-series-") || url.includes("/series/") ? "series" : "movie";
            
            if (url) {
                items.push(new MultimediaItem({
                    title, 
                    url, 
                    posterUrl: poster,
                    type: type
                }));
            }
        });
        return items;
    }

    async function getHome(cb) {
        try {
            const mainpage = [
                { title: "Home", url: "" },
                { title: "Movies", url: "category/movies/" },
                { title: "Series", url: "category/series/" }
            ];
            
            const results = {};
            const pages = await fetchMany(mainpage.map(cat => ({
                url: `${manifest.baseUrl}/${cat.url}`,
                headers: CommonHeaders,
                meta: cat
            })));
            pages.forEach(res => {
                const cat = res.meta;
                if (res && res.body) {
                    const parsed = parseRes(res.body);
                    if (parsed.length > 0) results[cat.title] = parsed;
                }
            });

            const homeItems = results["Home"] || [];
            const trendingCount = Math.min(8, homeItems.length);
            const trendingItems = homeItems.slice(0, trendingCount);

            await Promise.all(trendingItems.map(async (item) => {
                try {
                    const isMovie = item.type === "movie";
                    const tmdbId = await fetchTmdbId(item.title, isMovie);
                    if (tmdbId) {
                        const [details, externalIds] = await Promise.all([
                            fetchTmdbDetails(tmdbId, isMovie),
                            fetchTmdbExternalIds(tmdbId, isMovie)
                        ]);
                        if (details?.backdrop_path) {
                            item.bannerUrl = tmdbImage(details.backdrop_path);
                        }
                        if (externalIds?.imdb_id) {
                            item.logoUrl = `https://live.metahub.space/logo/medium/${externalIds.imdb_id}/img`;
                        }
                    }
                } catch (_) {}
            }));

            if (trendingItems.length > 0) {
                results["Trending"] = trendingItems;
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const url = `${manifest.baseUrl}/?s=${encodeURIComponent(query)}`;
            const res = await http_get(url, CommonHeaders);
            if (res && res.body) cb({ success: true, data: parseRes(res.body) });
            else cb({ success: true, data: [] });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load details" });
            
            const doc = new JsoupLite(res.body);
            const title = cleanText(doc.find("h1.page-title")?.textContent() || doc.find("h1")?.textContent()).split("(")[0].trim() || "Unknown";
            const poster = fixUrl(readMeta(doc, "property", "og:image"));
            const tags = doc.select("div.mt-2 span.badge").map(el => cleanText(el.textContent())).filter(Boolean);
            const year = parseInt(cleanText(doc.select("div.mt-2 span").find(el => /^\d{4}$/.test(cleanText(el.textContent())))?.textContent()), 10) || undefined;
            const trailerUrl = doc.find("#trailer-btn")?.attr("data-trailer-url") || "";
            const recommendations = parseRecommendations(doc);
            const isSeries = tags.length > 0
                ? !tags.some(tag => tag.toLowerCase() === "movies")
                : (url.includes("-series-") || doc.root.textContent().includes("Download Individual Episodes") || !!doc.find(".episode-download-item"));
            const isMovie = !isSeries;

            const tmdbId = await fetchTmdbId(title, isMovie).catch(() => null);
            const tmdbDetails = await fetchTmdbDetails(tmdbId, isMovie).catch(() => null);
            const externalIds = await fetchTmdbExternalIds(tmdbId, isMovie).catch(() => ({}));
            const imdbId = externalIds?.imdb_id || "";
            const logoUrl = imdbId ? `https://live.metahub.space/logo/medium/${imdbId}/img` : undefined;
            const tmdbTitle = cleanText(tmdbDetails?.title || tmdbDetails?.name);
            const tmdbDate = tmdbDetails?.release_date || tmdbDetails?.first_air_date || "";
            const tmdbYear = parseInt(String(tmdbDate).split("-")[0], 10) || undefined;
            const fixedTitle = tmdbTitle || title;
            const fixedPoster = tmdbImage(tmdbDetails?.poster_path) || poster;
            const fixedBackdrop = tmdbImage(tmdbDetails?.backdrop_path) || poster;
            const cast = parseTmdbCast(tmdbDetails);
            const trailers = [makeTrailer(trailerUrl)].filter(Boolean);
            const syncData = buildSyncData(tmdbId, imdbId);

            const descriptionEl = doc.find("div.content-section p.mt-4") || doc.find(".movie-description") || doc.select(".content-main p").find(p => p.textContent().length > 50);
            let description = descriptionEl ? stripHTML(descriptionEl.textContent()) : "";
            
            if (!description || description.length < 10) {
                doc.select("meta").forEach(m => { 
                    if (m.attr("name") === "description" || m.attr("property") === "og:description") {
                        const content = m.attr("content");
                        if (content && content.length > description.length) description = unescapeHTML(content);
                    }
                });
            }

            const fixedDescription = cleanText(tmdbDetails?.overview) || description;
            const commonData = {
                title: fixedTitle,
                url,
                posterUrl: fixedPoster,
                bannerUrl: fixedBackdrop,
                description: fixedDescription,
                year: tmdbYear || year,
                score: safeScore(tmdbDetails?.vote_average),
                logoUrl,
                cast: cast.length ? cast : undefined,
                trailers: trailers.length ? trailers : undefined,
                recommendations: recommendations.length ? recommendations : undefined,
                syncData
            };

            if (!isSeries) {
                const movieGroups = [];
                const movieSeen = new Set();

                doc.select(".download-item").forEach(item => {
                    const fileTitle = cleanText(item.find(".file-title")?.textContent()) || title;
                    const links = extractNodeLinks(item, fileTitle);
                    if (links.length === 0) return;

                    const quality = parseQuality(fileTitle);
                    const groupName = qualityLabel(quality) || fileTitle || "Direct";
                    movieGroups.push({ name: groupName, quality: quality || undefined, links });
                    links.forEach(link => movieSeen.add(link.url));
                });

                if (movieGroups.length === 0) {
                    const linksRegex = /href="(https?:\/\/(?:[a-z0-9-]+\.[a-z0-9-]+\/[^"]*[?&]id=|gadgetsweb|greenmotors|hubcloud|hubdrive|hubcdn|drive\.google\.com)[^"]+)"/gi;
                    const fallbackLinks = [];
                    let match;
                    while ((match = linksRegex.exec(res.body)) !== null) {
                        const streamUrl = fixUrl(match[1]);
                        if (!streamUrl || movieSeen.has(streamUrl)) continue;
                        movieSeen.add(streamUrl);
                        const source = sourceWithQuality(detectSourceName(streamUrl, "Direct"), parseQuality(streamUrl));
                        fallbackLinks.push({ name: source, source, url: streamUrl });
                    }
                    if (fallbackLinks.length > 0) movieGroups.push({ name: "Direct", links: fallbackLinks });
                }
                
                cb({
                    success: true,
                    data: new MultimediaItem({
                        ...commonData,
                        type: "movie",
                        episodes: [new Episode({ 
                            name: "Full Movie", 
                            season: 1, 
                            episode: 1, 
                            url: JSON.stringify(movieGroups), 
                            posterUrl: fixedPoster 
                        })]
                    })
                });
            } else {
                const episodesMap = new Map();
                const maxEpisodePerSeason = {};

                const epItems = doc.select(".episode-download-item");
                if (epItems.length > 0) {
                    epItems.forEach(item => {
                        const epTitle = cleanText(item.find(".episode-file-title")?.textContent()) || "Episode";
                        const seasonItem = findAncestor(item, ".season-item");
                        const seasonText = cleanText(seasonItem?.find(".episode-number")?.textContent());
                        const seasonNum = parseSeasonNumber(seasonText) || parseSeasonNumber(epTitle) || 1;
                        const epNum = parseEpisodeNumber(item.find(".badge-psa")?.textContent()) || parseEpisodeNumber(epTitle);
                        if (!epNum) return;

                        const links = extractNodeLinks(item, epTitle);
                        if (links.length === 0) return;

                        const key = `${seasonNum}:${epNum}`;
                        const entry = episodesMap.get(key) || {
                            season: seasonNum,
                            episode: epNum,
                            name: `Episode ${epNum}`,
                            posterUrl: fixedPoster,
                            links: []
                        };

                        addDistinctLinks(entry.links, links);
                        episodesMap.set(key, entry);
                        maxEpisodePerSeason[seasonNum] = Math.max(maxEpisodePerSeason[seasonNum] || 0, epNum);
                    });
                }

                doc.select(".download-item").forEach(item => {
                    const headerText = cleanText(item.find(".font-semibold")?.textContent() || item.textContent());
                    const seasonNum = parseSeasonNumber(headerText);
                    if (!seasonNum) return;

                    const fileTitle = cleanText(item.find(".file-title")?.textContent());
                    const links = extractNodeLinks(item, `${headerText} ${fileTitle}`);
                    if (links.length === 0) return;

                    const nextEpisode = (maxEpisodePerSeason[seasonNum] || 0) + 1;
                    const key = `${seasonNum}:${nextEpisode}`;
                    const quality = qualityLabel(parseQuality(`${headerText} ${fileTitle}`));
                    const name = `S${String(seasonNum).padStart(2, "0")} Pack ${quality}`.trim();

                    episodesMap.set(key, {
                        season: seasonNum,
                        episode: nextEpisode,
                        name,
                        posterUrl: fixedPoster,
                        links
                    });
                    maxEpisodePerSeason[seasonNum] = nextEpisode;
                });

                const tmdbSeasonCache = {};
                if (tmdbId) {
                    const seasons = Array.from(new Set(Array.from(episodesMap.values()).map(item => item.season).filter(Boolean)));
                    const seasonPages = await fetchMany(seasons.map(season => ({
                        url: `${TMDB_API}/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`,
                        headers: CommonHeaders,
                        meta: season
                    })));
                    seasonPages.forEach(page => {
                        try {
                            tmdbSeasonCache[page.meta] = JSON.parse(page.body || "null");
                        } catch {
                            tmdbSeasonCache[page.meta] = null;
                        }
                    });
                }

                const episodes = Array.from(episodesMap.values())
                    .sort(compareEpisodes)
                    .map(item => {
                        const tmdbEp = getTmdbEpisodeInfo(tmdbSeasonCache[item.season], item.episode);
                        return new Episode({
                            name: tmdbEp.name || item.name,
                            season: item.season,
                            episode: item.episode,
                            url: JSON.stringify([{ name: item.name, links: item.links }]),
                            posterUrl: tmdbEp.posterUrl || item.posterUrl || fixedPoster,
                            description: tmdbEp.description || undefined,
                            airDate: tmdbEp.airDate,
                            rating: tmdbEp.rating
                        });
                    });

                if (episodes.length === 0) {
                    doc.select("a").forEach(a => {
                        const href = a.attr("href");
                        if (href && (href.includes("episode") || href.includes("season"))) {
                            episodes.push(new Episode({
                                name: cleanText(a.textContent()),
                                url: fixUrl(href),
                                posterUrl: fixedPoster
                            }));
                        }
                    });
                }
                
                cb({ success: true, data: new MultimediaItem({ ...commonData, type: "series", episodes }) });
            }
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const data = normalizeStreamData(dataStr);
            const queue = buildStreamQueue(data);

            if (queue.length === 0) return cb({ success: true, data: [] });

            const results = [];
            const seenResults = new Set();
            const extractedGroups = await Promise.all(queue.map(async link => {
                const resolvedUrl = await resolveRedirectUrl(link.url);
                if (!resolvedUrl) return [];
                return await resolveStreamLink(resolvedUrl, link);
            }));

            extractedGroups.flat().forEach(result => {
                    const key = result.url;
                    if (!key || seenResults.has(key)) return;
                    seenResults.add(key);
                    results.push(result);
            });

            results.sort((a, b) => (b.quality || 0) - (a.quality || 0) || String(a.source || "").localeCompare(String(b.source || "")));
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    function normalizeStreamData(dataStr) {
        try {
            const parsed = JSON.parse(dataStr);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === "object") return [parsed];
        } catch {}
        return [{ name: "Auto", links: [{ url: dataStr, name: "Auto" }] }];
    }

    function buildStreamQueue(groups) {
        const queue = [];
        const seen = new Set();

        groups.forEach(group => {
            const links = Array.isArray(group?.links) ? group.links : [];
            const groupQuality = parseInt(group?.quality, 10) || parseQuality(group?.name);

            links.forEach(link => {
                const url = fixUrl(link?.url);
                if (!url || seen.has(url)) return;

                const quality = parseInt(link?.quality, 10) || parseQuality(`${link?.name || ""} ${group?.name || ""} ${url}`) || groupQuality;
                const fallback = normalizeSourceName(link?.source || link?.name || group?.name) || detectSourceName(url);
                const source = sourceWithQuality(detectSourceName(url, fallback), quality);

                seen.add(url);
                queue.push({ url, source, quality });
            });
        });

        return queue;
    }

    async function resolveRedirectUrl(url) {
        if (url.includes("gadgetsweb") || url.includes("greenmotors") || url.includes("id=")) {
            return await getRedirectLinks(url);
        }
        return url;
    }

    async function resolveStreamLink(url, link) {
        if (url.includes("hubcloud")) {
            const extracted = await extractHubCloudStreams(url, link.source, link.quality);
            if (extracted.length > 0) return extracted.map(item => toStreamResult(item, link));
        }

        if (url.includes("hubdrive")) {
            const extracted = await extractHubDriveStreams(url, link.source, link.quality);
            if (extracted.length > 0) return extracted.map(item => toStreamResult(item, link));
        }

        return [toStreamResult({ url, source: link.source, quality: link.quality }, link)];
    }

    function toStreamResult(item, fallback) {
        const quality = parseInt(item.quality, 10) || parseInt(fallback.quality, 10) || parseQuality(`${item.source || ""} ${fallback.source || ""} ${item.url || ""}`);
        return new StreamResult({
            url: item.url,
            source: sourceWithQuality(item.source || fallback.source || "Auto", quality),
            quality: quality || undefined,
            headers: CommonHeaders
        });
    }

    function extractHubCloudStreams(url, source, quality) {
        return new Promise(resolve => {
            extractHubCloud(url, extracted => resolve(Array.isArray(extracted) ? extracted : []), source, quality);
        });
    }

    function extractHubDriveStreams(url, source, quality) {
        return new Promise(resolve => {
            extractHubDrive(url, extracted => resolve(Array.isArray(extracted) ? extracted : []), source, quality);
        });
    }

    async function extractHubDrive(url, callback, sourceName = "HubDrive", qualityHint = 0) {
        try {
            const headers = { ...CommonHeaders, "Cookie": "xla=s4t", "Referer": url };
            const res = await http_get(url, headers);
            if (!res || !res.body) return callback([]);

            const html = res.body;

            // Strategy 1: Find hubcloud links in the page and process them
            const hcRegex = /https?:\/\/hubcloud\.[a-z0-9-]+\/drive\/[a-z0-9]+/gi;
            const hcMatches = html.match(hcRegex) || [];
            const uniqueHcUrls = [...new Set(hcMatches.map(u => u.replace(/[^a-zA-Z0-9:/._~-]/g, '')))];

            if (uniqueHcUrls.length > 0) {
                const allResults = [];
                for (const hcUrl of uniqueHcUrls) {
                    const hcExtracted = await extractHubCloudStreams(hcUrl, sourceName, qualityHint);
                    allResults.push(...hcExtracted);
                }
                if (allResults.length > 0) return callback(allResults);
            }

            // Strategy 2: Try the AJAX direct-download endpoint
            const downIdMatch = html.match(/name="id"\s+value="(\d+)"/);
            const downId = downIdMatch ? downIdMatch[1] : (url.match(/\/file\/(\d+)/)?.[1]);

            if (downId) {
                try {
                    const base = url.replace(/\/file\/\d+.*$/, '');
                    const ajaxUrl = `${base}/ajax.php?ajax=direct-download`;
                    const ajaxRes = await http_get(`${ajaxUrl}&id=${downId}`, {
                        ...headers,
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": url
                    });
                    if (ajaxRes && ajaxRes.body) {
                        try {
                            const ajaxJson = JSON.parse(ajaxRes.body);
                            if (ajaxJson?.direct_download_link) {
                                return callback([{
                                    url: ajaxJson.direct_download_link,
                                    source: sourceWithQuality(sourceName, qualityHint),
                                    quality: qualityHint || undefined
                                }]);
                            }
                        } catch {}
                    }
                } catch {}
            }

            // Strategy 3: Try to extract buttons from the page
            const extracted = extractFinalButtons(html, sourceName, qualityHint, url);
            if (extracted.length > 0) return callback(extracted);

            callback([]);
        } catch {
            callback([]);
        }
    }

    function base64Decode(str) {
        try {
            return atob(str);
        } catch { return ""; }
    }

    function pen(v) {
        if (!v) return "";
        let out = "";
        for (let i = 0; i < v.length; i++) {
            const c = v[i];
            if (c >= 'A' && c <= 'Z') out += String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
            else if (c >= 'a' && c <= 'z') out += String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
            else out += c;
        }
        return out;
    }

    async function getRedirectLinks(url) {
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return "";
            const html = res.body;
            let combined = "";
            const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let match;
            while ((match = regex.exec(html)) !== null) combined += (match[1] || match[2]);
            if (!combined) return "";
            const rawDecoded = base64Decode(combined);
            const pDecoded = pen(base64Decode(rawDecoded));
            const decoded = JSON.parse(base64Decode(pDecoded));
            if (decoded.o) return base64Decode(decoded.o).trim();
            return "";
        } catch { return ""; }
    }

    async function extractHubCloud(url, callback, sourceName = "HubCloud", qualityHint = 0) {
        try {
            let currentUrl = String(url || "").replace("hubcloud.ink", "hubcloud.dad");
            const headers = { ...CommonHeaders, "Cookie": "xla=s4t", "Referer": currentUrl };
            const res = await http_get(currentUrl, headers);
            if (!res || !res.body) return callback([]);

            let pageData = res.body;
            let finalUrl = currentUrl;

            if (!currentUrl.includes("hubcloud.php")) {
                const firstDoc = new JsoupLite(pageData);
                let nextHref = firstDoc.find("#download")?.attr("href") || "";
                if (!nextHref) {
                    const scriptUrlMatch = pageData.match(/var url = '([^']*)'/);
                    if (scriptUrlMatch) nextHref = scriptUrlMatch[1];
                }

                if (nextHref) {
                    nextHref = resolveUrl(nextHref, currentUrl);
                    finalUrl = nextHref;
                    const res2 = await http_get(finalUrl, { ...CommonHeaders, "Cookie": "xla=s4t", "Referer": currentUrl });
                    if (res2 && res2.body) pageData = res2.body;
                }
            }

            const extracted = extractFinalButtons(pageData, sourceName, qualityHint, finalUrl);
            callback(extracted);
        } catch {
            callback([]);
        }
    }

    function extractFinalButtons(html, sourceName = "HubCloud", qualityHint = 0, baseUrl = manifest.baseUrl) {
        const doc = new JsoupLite(html);
        const extracted = [];
        const seen = new Set();
        const dynamicHrefMap = parseDynamicHrefMap(html, baseUrl);
        const header = cleanText(doc.find(".card-header")?.textContent()) || cleanText(doc.find("h1")?.textContent());
        const size = cleanText(doc.find("#size")?.textContent());
        const quality = parseInt(qualityHint, 10) || parseQuality(header) || parseQuality(html);
        const labelExtras = `${header ? `[${header}]` : ""}${size ? `[${size}]` : ""}`.trim();

        const buttons = selectMany(doc, [
            "a.btn",
            "a.btn-lg",
            "a.btn-primary",
            "a.btn-success",
            "a.btn-danger",
            "a"
        ]);
        buttons.forEach(el => {
            const href = resolveUrl(dynamicHrefMap[el.attr("id")] || el.attr("href"), baseUrl);
            const label = normalizeSourceName(el.textContent());
            const lowerLabel = label.toLowerCase();
            if (!href || /telegram|facebook|twitter|tinyurl|tutorial|logout|login|\/tg\/go/i.test(`${href} ${lowerLabel}`)) return;
            if (!/hubcdn|hubcloud|hubdrive|pixeldrain|pixel|odyssey|fsl|buzz|zip|mega|gpdl|download/i.test(`${href} ${lowerLabel}`)) return;

            let source = sourceName;
            if (lowerLabel.includes("fsl server")) source = `${sourceName} [FSL]`;
            else if (lowerLabel.includes("s3 server")) source = `${sourceName} [S3]`;
            else if (lowerLabel.includes("fslv2")) source = `${sourceName} [FSLv2]`;
            else if (lowerLabel.includes("mega server")) source = `${sourceName} [Mega]`;
            else if (lowerLabel.includes("zipdisk")) source = `${sourceName} [ZipDisk]`;
            else if (lowerLabel.includes("buzzserver")) source = "BuzzServer";
            else if (lowerLabel.includes("pixel")) source = "PixelDrain";
            else if (label && !lowerLabel.includes("download file")) source = `${sourceName} ${label}`;

            let finalUrl = href;
            if (lowerLabel.includes("pixel") && !/api\/file|download/i.test(finalUrl)) {
                const pixelId = (finalUrl.match(/\/(?:u|file)\/([^/?#]+)/i)?.[1] || finalUrl.split("/").pop() || "").trim();
                if (pixelId) finalUrl = `https://pixeldrain.com/api/file/${pixelId}?download`;
            }

            if (!/^https?:\/\//i.test(finalUrl) || seen.has(finalUrl)) return;
            seen.add(finalUrl);
            extracted.push({
                url: finalUrl,
                source: sourceWithQuality(source, quality),
                quality: quality || undefined,
                size: size || undefined,
                name: `${source} ${labelExtras}`.trim()
            });
        });

        return extracted;
    }

    // Export to global scope
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
