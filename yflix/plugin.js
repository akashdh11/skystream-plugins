(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    class JNode {
        constructor(tag = null, attrs = {}, parent = null) {
            this.tag = tag; this.attrs = attrs; this.parent = parent; this.children = []; this.text = "";
        }
        attr(name) { return this.attrs[name] || ""; }
        textContent() {
            let t = this.text;
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
            selector = selector.trim();
            if (selector[0] === "#") return this.attrs.id === selector.slice(1);
            if (selector[0] === ".") return (this.attrs.class || "").split(/\s+/).includes(selector.slice(1));
            if (selector.includes(".")) {
                const idx = selector.indexOf(".");
                const tag = selector.slice(0, idx), cls = selector.slice(idx + 1);
                return this.tag === tag && (this.attrs.class || "").split(/\s+/).includes(cls);
            }
            if (selector.includes("#")) {
                const idx = selector.indexOf("#");
                const tag = selector.slice(0, idx), id = selector.slice(idx + 1);
                return this.tag === tag && this.attrs.id === id;
            }
            return this.tag === selector;
        }
        selectFirst(selector) {
            for (const c of this.children) {
                if (c.matches(selector)) return c;
                const r = c.selectFirst(selector);
                if (r) return r;
            }
            return null;
        }
        find(selector) { return this.selectFirst(selector); }
        select(selector, out = []) {
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
            const re = /<\/?[^>]+>|[^<]+/g;
            let m;
            while ((m = re.exec(html))) {
                const token = m[0];
                if (token.startsWith("</")) {
                    if (current.parent) current = current.parent;
                    continue;
                }
                if (token.startsWith("<")) {
                    const selfClosing = token.endsWith("/>") || ["br", "img", "input", "meta", "link"].includes(token.replace(/^<|\/?>$/g, "").trim().split(/\s+/)[0].toLowerCase());
                    const clean = token.replace(/^<|\/?>$/g, "").trim();
                    const parts = clean.split(/\s+/);
                    const tag = parts.shift().toLowerCase();
                    const attrs = {};
                    for (const p of parts) {
                        const i = p.indexOf("=");
                        if (i > 0) attrs[p.slice(0, i)] = p.slice(i + 1).replace(/^["']|["']$/g, "");
                    }
                    const node = new JNode(tag, attrs, current);
                    current.children.push(node);
                    if (!selfClosing) current = node;
                    continue;
                }
                const text = token.trim();
                if (text) {
                    const t = new JNode(null, {}, current); t.text = text; current.children.push(t);
                }
            }
        }
        find(selector) { return this.root.find(selector); }
        select(selector) { return this.root.select(selector); }
    }

    const YFXENC = "https://enc-dec.app/api/enc-movies-flix";
    const YFXDEC = "https://enc-dec.app/api/dec-movies-flix";
    const KAIMEG = "https://enc-dec.app/api/dec-mega";
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API = "https://orange-voice-abcf.phisher16.workers.dev";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
    const MEGAUP_HOST_RE = /(?:megaup\.live|4spromax\.site|rapidairmax\.site|rapidshare\.(?:cc|work))/i;

    const YflixHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": `${manifest.baseUrl}/`
    };

    const MegaHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
        "Accept": "text/html, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.5",
        "Sec-GPC": "1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Priority": "u=0",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Referer": `${manifest.baseUrl}/`
    };

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return manifest.baseUrl + url;
        return url;
    }

    function resolveUrl(base, path) {
        try { return new URL(path, base).toString(); } catch { return path || ""; }
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/\\u003C/g, "<").replace(/\\u003E/g, ">").replace(/\\u0022/g, "\"").replace(/\\u0027/g, "'").replace(/\\u0026/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#039;/g, "'").replace(/&amp;/g, "&");
    }

    function parseJsonSafe(text, fallback = null) {
        try { return JSON.parse(String(text || "")); } catch { return fallback; }
    }

    function firstMatch(text, patterns) {
        const source = String(text || "");
        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match && match[1]) return decodeHtml(match[1]).trim();
        }
        return "";
    }

    function stripTags(text) {
        return decodeHtml(String(text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    }

    function getQuality(text) {
        const value = String(text || "").toLowerCase();
        if (value.includes("2160p") || /\b4k\b/.test(value)) return 2160;
        if (value.includes("1080p")) return 1080;
        if (value.includes("720p")) return 720;
        if (value.includes("480p")) return 480;
        if (value.includes("360p")) return 360;
        return 0;
    }

    function qualityLabel(quality) {
        quality = Number(quality || 0);
        return quality ? `${quality}p` : "";
    }

    function sourceWithQuality(source, quality) {
        const clean = String(source || "Yflix").replace(/\s+/g, " ").trim();
        const label = qualityLabel(quality);
        if (!label || /\b(?:2160p|1080p|720p|480p|360p|4k)\b/i.test(clean)) return clean;
        return `${clean} ${label}`;
    }

    function uniqueBy(list, keyFn) {
        const out = [];
        const seen = new Set();
        for (const item of list || []) {
            const key = keyFn(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    }

    async function fetchJson(url) {
        try {
            const res = await http_get(url, YflixHeaders);
            return parseJsonSafe(res?.body, null);
        } catch { return null; }
    }

    async function findTmdbId(title, isTv, year) {
        const yearParam = year ? (isTv ? `&first_air_date_year=${year}` : `&year=${year}`) : "";
        const json = await fetchJson(`${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title || "")}${yearParam}`);
        const results = json?.results || [];
        const targetType = isTv ? "tv" : "movie";
        const normalizedTitle = String(title || "").trim().toLowerCase();
        const itemYear = item => Number(String(item?.release_date || item?.first_air_date || "").slice(0, 4)) || 0;

        const exact = results.find(item => {
            if (item?.media_type !== targetType) return false;
            const resultTitle = String(isTv ? item.name : item.title || "").trim().toLowerCase();
            return resultTitle === normalizedTitle && (!year || itemYear(item) === Number(year));
        });
        if (exact?.id) return exact.id;

        if (year) {
            return null;
        }

        for (const item of results) {
            if (item?.media_type !== targetType) continue;
            const resultTitle = String(isTv ? item.name : item.title || "").trim().toLowerCase();
            if (resultTitle === normalizedTitle) return item.id;
        }
        return results.find(item => item?.media_type === targetType)?.id || null;
    }

    function parseTmdbCast(creditsJson) {
        const cast = creditsJson?.cast || [];
        return cast.slice(0, 20).map(item => new Actor({
            name: item.name || item.original_name || "",
            role: item.character || "",
            image: item.profile_path ? `${TMDB_IMAGE_BASE}${item.profile_path}` : undefined
        })).filter(item => item.name);
    }

    async function fetchTmdbInfo(title, isTv, year) {
        const tmdbId = await findTmdbId(title, isTv, year);
        if (!tmdbId) return {};

        const route = isTv ? "tv" : "movie";
        const details = await fetchJson(`${TMDB_API}/${route}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`);
        const external = await fetchJson(`${TMDB_API}/${route}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
        const credits = await fetchJson(`${TMDB_API}/${route}/${tmdbId}/credits?api_key=${TMDB_API_KEY}&language=en-US`);
        const imdbId = external?.imdb_id || "";

        return {
            tmdbId,
            imdbId,
            logoUrl: imdbId ? `https://live.metahub.space/logo/medium/${imdbId}/img` : "",
            bannerUrl: details?.backdrop_path ? `${TMDB_IMAGE_BASE}${details.backdrop_path}` : "",
            cast: parseTmdbCast(credits)
        };
    }

    async function fetchTmdbSeason(tmdbId, season) {
        if (!tmdbId || !season) return {};
        const json = await fetchJson(`${TMDB_API}/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}&language=en-US`);
        const out = {};
        for (const item of json?.episodes || []) {
            const episodeNumber = Number(item.episode_number || 0);
            if (!episodeNumber) continue;
            out[episodeNumber] = {
                title: item.name || "",
                description: item.overview || "",
                posterUrl: item.still_path ? `${TMDB_IMAGE_BASE}${item.still_path}` : "",
                airDate: item.air_date || "",
                score: item.vote_average ? Number(Number(item.vote_average).toFixed(1)) : undefined
            };
        }
        return out;
    }

    function parseRes(html) {
        const doc = new JsoupLite(html);
        const items = [];
        const filmBlocks = doc.select("div.item");
        filmBlocks.forEach(card => {
            const titleEl = card.find("a.title");
            const title = titleEl ? titleEl.textContent().trim() : "Unknown Title";
            const posterEl = card.find("a.poster");
            const url = posterEl ? fixUrl(posterEl.attr("href")) : "";
            let poster = "";
            const img = card.find("img");
            if (img) poster = img.attr("data-src") || img.attr("src") || "";
            poster = fixUrl(poster);
            const quality = getQuality(card.find("div.quality")?.textContent() || title);
            const metadata = card.find("div.metadata")?.textContent() || "";
            const type = /TV|SS\s*\d+|EP\s*\d+/i.test(metadata) ? "series" : "movie";
            if (url) items.push(new MultimediaItem({ 
                title, 
                url, 
                posterUrl: poster,
                type,
                quality: quality || undefined
            }));
        });
        return items;
    }

    async function getHome(cb) {
        try {
            const mainpage = [
                { title: "Trending Movies", url: "browser?type%5B%5D=movie&sort=trending" },
                { title: "Trending TV Shows", url: "browser?type%5B%5D=tv&sort=trending" },
                { title: "Top IMDB", url: "browser?sort=imdb" },
                { title: "Latest Release", url: "browser?sort=release_date" }
            ];
            const results = {};
            for (const cat of mainpage) {
                const url = `${manifest.baseUrl}/${cat.url}`;
                const res = await http_get(url, YflixHeaders);
                if (res && res.status === 200 && res.body) {
                    const items = parseRes(res.body);
                    if (items.length) {
                        const seen = new Set();
                        results[cat.title] = items.filter(i => {
                            if (seen.has(i.url)) return false;
                            seen.add(i.url); return true;
                        });
                    }
                }
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const url = `${manifest.baseUrl}/browser?keyword=${encodeURIComponent(query)}`;
            const res = await http_get(url, YflixHeaders);
            if (res && res.status === 200 && res.body) cb({ success: true, data: parseRes(res.body) });
            else cb({ success: true, data: [] });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    async function decode(text) {
        try {
            const res = await http_get(`${YFXENC}?text=${encodeURIComponent(text)}`, YflixHeaders);
            return JSON.parse(res.body)?.result || "";
        } catch { return ""; }
    }

    async function decodeReverse(text) {
        try {
            const res = await http_post(YFXDEC, { "Content-Type": "application/json" }, JSON.stringify({ text: text }));
            return extractVideoUrlFromDecodedPayload(JSON.parse(res.body)?.result || "");
        } catch { return ""; }
    }

    async function decodeReversePayload(text) {
        try {
            const res = await http_post(YFXDEC, { "Content-Type": "application/json" }, JSON.stringify({ text: text }));
            return JSON.parse(res.body)?.result || "";
        } catch { return ""; }
    }

    function extractVideoUrlFromDecodedPayload(payload) {
        if (!payload) return "";
        if (typeof payload === "object") {
            return payload.url || payload.file || payload.src || payload.link || "";
        }

        const text = decodeHtml(String(payload || "").trim());
        if (/^https?:\/\//i.test(text)) return text;

        const json = parseJsonSafe(text, null);
        if (json) {
            if (typeof json === "string") return extractVideoUrlFromDecodedPayload(json);
            return json.url || json.file || json.src || json.link || "";
        }

        return firstMatch(text, [
            /<iframe[^>]+src=["']([^"']+)["']/i,
            /(?:src|url|file|link)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
            /(https?:\/\/[^\s"'<>\\]+)/i
        ]);
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, YflixHeaders);
            if (!res || res.status !== 200 || !res.body) return cb({ success: false, errorCode: "SITE_OFFLINE" });
            
            const doc = new JsoupLite(res.body);
            const title = doc.find("h1.title")?.textContent()?.trim() || "Unknown";
            const poster = fixUrl(doc.find("div.poster")?.find("img")?.attr("src") || doc.find("div.detailWrap")?.find("img")?.attr("src") || "");
            const description = doc.find("div.description")?.textContent()?.trim() || "";
            const dataId = doc.find("#movie-rating")?.attr("data-id") || "";
            const keyword = url.split("/watch/")[1]?.split(".")[0] || "";
            const metadataHtml = firstMatch(res.body, [/<div[^>]+class=["'][^"']*metadata[^"']*set[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]);
            const year = parseInt(firstMatch(metadataHtml, [/\b(19\d{2}|20\d{2})\b/]), 10) || undefined;
            const scoreText = firstMatch(res.body, [/<span[^>]+class=["'][^"']*IMDb[^"']*["'][^>]*>([\s\S]*?)<\/span>/i]);
            const score = parseFloat(scoreText) || undefined;
            const contentRating = stripTags(firstMatch(res.body, [/<span[^>]+class=["'][^"']*ratingR[^"']*["'][^>]*>([\s\S]*?)<\/span>/i])) || undefined;
            const backgroundPoster = fixUrl(firstMatch(res.body, [
                /<div[^>]+class=["'][^"']*(?:detail-bg|site-movie-bg)[^"']*["'][^>]+style=["'][^"']*url\(['"]?([^'")]+)['"]?\)/i
            ]));
            const recommendations = parseRes(res.body).filter(item => item.url !== url).slice(0, 20);

            const decoded = await decode(dataId);
            const epUrl = `${manifest.baseUrl}/ajax/episodes/list?keyword=${keyword}&id=${dataId}&_=${decoded}`;
            const epRes = await http_get(epUrl, YflixHeaders);
            
            if (!epRes || epRes.status !== 200 || !epRes.body) return cb({ success: false, errorCode: "PARSE_ERROR" });
            
            const epJson = JSON.parse(epRes.body);
            const html = epJson.result || "";
            const epDoc = new JsoupLite(html);
            const episodeLinks = epDoc.select("ul.episodes a");
            
            const isTv = url.includes("/tv/") || /TV|SS\s*\d+|EP\s*\d+/i.test(stripTags(metadataHtml));
            const tmdbInfo = await fetchTmdbInfo(title, isTv, year);
            const episodes = [];

            if (episodeLinks.length === 1 && episodeLinks[0].textContent().toLowerCase().includes("movie")) {
                episodes.push(new Episode({ 
                    name: "Full Movie", 
                    season: 1, 
                    episode: 1, 
                    posterUrl: poster, 
                    url: episodeLinks[0].attr("eid")
                }));
            } else {
                epDoc.select("ul.episodes").forEach(seasonBlock => {
                    const season = parseInt(seasonBlock.attr("data-season")) || 1;
                    episodes.push({ __seasonMarker: true, seasonBlock, season });
                });

                const expandedEpisodes = [];
                for (const seasonItem of episodes) {
                    const seasonBlock = seasonItem.seasonBlock;
                    const season = seasonItem.season;
                    const seasonMeta = await fetchTmdbSeason(tmdbInfo.tmdbId, season);
                    seasonBlock.select("a").forEach((epEl, idx) => {
                        const eid = epEl.attr("eid");
                        if (eid) {
                            const epNum = parseInt(epEl.attr("num")) || (idx + 1);
                            const meta = seasonMeta[epNum] || {};
                            const epTitle = meta.title || epEl.find("span")?.textContent()?.trim() || `Episode ${epNum}`;
                            expandedEpisodes.push(new Episode({ 
                                name: epTitle || `Episode ${epNum}`,
                                season, 
                                episode: epNum, 
                                posterUrl: meta.posterUrl || poster,
                                description: meta.description || undefined,
                                airDate: meta.airDate || undefined,
                                score: meta.score,
                                url: eid
                            }));
                        }
                    });
                }
                episodes.length = 0;
                episodes.push(...expandedEpisodes);
            }

            cb({ success: true, data: new MultimediaItem({
                title,
                url,
                posterUrl: poster,
                bannerUrl: tmdbInfo.bannerUrl || backgroundPoster || poster,
                logoUrl: tmdbInfo.logoUrl || undefined,
                description,
                type: isTv ? "series" : "movie",
                year,
                score,
                contentRating,
                recommendations,
                cast: tmdbInfo.cast || [],
                episodes
            })});
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    async function buildM3u8Streams(m3u8Url, source, referer) {
        const headers = { "Referer": referer || manifest.baseUrl };
        try {
            const res = await http_get(m3u8Url, headers);
            const body = String(res?.body || "");
            const streams = [];
            const lines = body.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
                const next = lines.slice(i + 1).find(item => item && !item.startsWith("#"));
                if (!next) continue;
                const quality = getQuality(line) || (line.match(/RESOLUTION=\d+x(\d+)/i) ? parseInt(line.match(/RESOLUTION=\d+x(\d+)/i)[1], 10) : 0);
                streams.push(new StreamResult({
                    url: resolveUrl(m3u8Url, next.trim()),
                    source: sourceWithQuality(source, quality),
                    quality: quality || undefined,
                    headers
                }));
            }

            if (streams.length) return uniqueBy(streams, item => item.url);
        } catch {}

        const fallbackQuality = getQuality(m3u8Url) || 1080;
        return [new StreamResult({
            url: m3u8Url,
            source: sourceWithQuality(source, fallbackQuality),
            quality: fallbackQuality,
            headers
        })];
    }

    async function extractMegaUp(url, referer, quality) {
        try {
            const mediaUrl = url.replace("/e2/", "/media/").replace("/e/", "/media/");
            const res = await http_get(mediaUrl, MegaHeaders);
            const encoded = JSON.parse(res.body).result;
            if (!encoded) return [];
            
            const postRes = await http_post(KAIMEG, { "Content-Type": "application/json" }, JSON.stringify({ text: encoded, agent: MegaHeaders["User-Agent"] }));
            const result = JSON.parse(postRes.body).result;
            const sources = result?.sources || [];
            const streams = [];
            for (const item of sources) {
                const m3u8 = typeof item === "string" ? item : item?.file;
                if (!m3u8) continue;
                const built = await buildM3u8Streams(m3u8, referer || "MegaUp", manifest.baseUrl);
                streams.push(...built);
            }
            if (streams.length) return streams;
        } catch {}
        return [];
    }

    function getServerNodes(html) {
        const doc = new JsoupLite(html);
        return doc.select("li.server").concat(doc.select("div.server"));
    }

    function parseLoadStreamsInput(dataStr) {
        const parsed = parseJsonSafe(dataStr, null);
        const eids = [];

        function addEid(value) {
            const raw = String(value || "").trim();
            if (!raw) return;
            eids.push(raw.includes("/") ? raw.split("/").filter(Boolean).pop() : raw);
        }

        if (Array.isArray(parsed)) {
            parsed.forEach(item => {
                if (item?.links && Array.isArray(item.links)) {
                    item.links.forEach(link => addEid(link?.url));
                } else {
                    addEid(item?.url || item);
                }
            });
        } else if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed.links)) parsed.links.forEach(link => addEid(link?.url));
            else addEid(parsed.url || parsed.eid || parsed.id);
        } else {
            addEid(dataStr);
        }

        return Array.from(new Set(eids.filter(Boolean)));
    }

    async function resolveYflixVideoUrl(videoUrl, displayName) {
        if (!videoUrl) return [];
        if (/\.m3u8(?:$|[?#])/i.test(videoUrl)) return buildM3u8Streams(videoUrl, displayName, manifest.baseUrl);
        if (MEGAUP_HOST_RE.test(videoUrl)) return extractMegaUp(videoUrl, displayName, null);
        return [new StreamResult({
            url: videoUrl,
            source: displayName || "Yflix",
            headers: { "Referer": manifest.baseUrl }
        })];
    }

    async function loadStreams(dataStr, cb) {
        try {
            const eids = parseLoadStreamsInput(dataStr);
            const results = [];
            
            for (const eid of eids) {
                const decodedEid = await decode(eid);
                if (!decodedEid) continue;
                
                const listRes = await http_get(`${manifest.baseUrl}/ajax/links/list?eid=${eid}&_=${decodedEid}`, YflixHeaders);
                if (!listRes || !listRes.body) continue;
                
                const listData = JSON.parse(listRes.body);
                const html = decodeHtml(listData.result || "");
                const servers = getServerNodes(html);
                
                for (const server of servers) {
                    const lid = server.attr("data-lid");
                    const serverName = server.find("span")?.textContent()?.trim() || "Server";
                    if (!lid) continue;
                    
                    const decodedLid = await decode(lid);
                    if (!decodedLid) continue;
                    
                    const viewRes = await http_get(`${manifest.baseUrl}/ajax/links/view?id=${lid}&_=${decodedLid}`, YflixHeaders);
                    if (!viewRes || !viewRes.body) continue;
                    
                    const viewData = JSON.parse(viewRes.body);
                    const result = viewData.result || "";
                    if (!result) continue;
                    
                    const decodedPayload = await decodeReversePayload(result);
                    const videoUrl = extractVideoUrlFromDecodedPayload(decodedPayload);
                    if (!videoUrl) continue;
                    
                    const extracted = await resolveYflixVideoUrl(videoUrl, "⌜ Yflix ⌟ | " + serverName);
                    results.push(...extracted);
                }
            }
            cb({ success: true, data: uniqueBy(results, item => item.url + "|" + item.source) });
        } catch { 
            cb({ success: false, errorCode: "PARSE_ERROR" }); 
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
