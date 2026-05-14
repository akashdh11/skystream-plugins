(function () {
    const MAIN_URL = (manifest && manifest.baseUrl) || "https://animesalt.ac";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    const HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };

    const HOME_SECTIONS = [
        { path: "category/status/ongoing", name: "On-Air Shows", type: "series" },
        { path: "category/type/anime/?type=series", name: "New Anime Arrivals", type: "series" },
        { path: "category/type/cartoon/?type=series", name: "Just In: Cartoon Series", type: "series" },
        { path: "category/type/anime/?type=movies", name: "Latest Anime Movies", type: "movie" },
        { path: "category/type/cartoon/?type=movies", name: "Fresh Cartoon Films", type: "movie" },
        { path: "category/network/crunchyroll", name: "Crunchyroll", type: "series" },
        { path: "category/network/netflix", name: "Netflix", type: "series" },
        { path: "category/network/prime-video", name: "Prime Video", type: "series" }
    ];

    function text(value) {
        return (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    }

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === "object") return data;
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }

    function asArray(list) {
        if (!list) return [];
        try {
            return Array.from(list);
        } catch (e) {
            const out = [];
            for (let i = 0; i < list.length; i++) out.push(list[i]);
            return out;
        }
    }

    function qsa(root, selector) {
        try {
            return asArray(root.querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    function qs(root, selector) {
        try {
            return root.querySelector(selector);
        } catch (e) {
            return null;
        }
    }

    function attr(el, names) {
        if (!el) return "";
        for (const name of names) {
            const value = el.getAttribute(name);
            if (value && !String(value).startsWith("data:image")) return String(value).trim();
        }
        return "";
    }

    function fixUrl(raw, base) {
        if (!raw) return "";
        const url = String(raw).trim();
        if (!url || url.startsWith("data:")) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (/^https?:\/\//i.test(url)) return url;
        try {
            return new URL(url, base || MAIN_URL).href;
        } catch (e) {
            return url;
        }
    }

    function getImageAttr(img, base) {
        return fixUrl(attr(img, ["data-src", "data-lazy-src", "data-original", "src"]), base);
    }

    function getHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch (e) {
            return "";
        }
    }

    function detectType(url, fallback) {
        if (/\/movies?\//i.test(url) || /type=movies/i.test(url)) return "movie";
        if (/\/series\//i.test(url) || /type=series/i.test(url)) return "series";
        return fallback || "series";
    }

    function payload(url, poster, type) {
        return JSON.stringify({ url, poster: poster || "", type: type || detectType(url) });
    }

    function inputPayload(value) {
        const data = safeParse(value);
        if (data && data.url) return data;
        return { url: String(value || ""), poster: "", type: detectType(String(value || "")) };
    }

    function qualityFromText(value, fallback) {
        const raw = String(value || "");
        const size = raw.match(/(?:^|[^\d])([1-9]\d{2,3})\s*p(?:[^\d]|$)/i);
        if (size) return parseInt(size[1], 10);
        if (/4k|2160/i.test(raw)) return 2160;
        if (/1440/i.test(raw)) return 1440;
        if (/1080|fhd/i.test(raw)) return 1080;
        if (/720|hd/i.test(raw)) return 720;
        if (/480|sd/i.test(raw)) return 480;
        if (/360/i.test(raw)) return 360;
        return fallback || 0;
    }

    function streamName(source, quality, tag) {
        const badge = quality ? ` [${quality}p]` : "";
        const suffix = tag ? ` [${tag}]` : "";
        return `${source}${badge}${suffix}`;
    }

    function encodeBase64String(value) {
        const input = String(value || "");
        try {
            if (typeof btoa === "function") return btoa(input);
        } catch (e) {}
        try {
            if (typeof Buffer !== "undefined") return Buffer.from(input, "binary").toString("base64");
        } catch (e) {}
        return "";
    }

    function proxifyUrl(url, headers, referer, mirrorHosts) {
        return "MAGIC_PROXY_v2" + encodeBase64String(JSON.stringify({
            url,
            headers: headers || {},
            options: {
                referer: referer || "",
                mirrorHosts: mirrorHosts || []
            }
        }));
    }

    function proxifyUrlV1(url) {
        return "MAGIC_PROXY_v1" + encodeBase64String(String(url || ""));
    }

    function buildMagicM3u8(body, playlistUrl, headers) {
        const lines = String(body || "").split(/\r?\n/);
        const rewritten = [];
        for (const rawLine of lines) {
            const line = String(rawLine || "");
            const trimmed = line.trim();
            if (!trimmed) {
                rewritten.push(line);
                continue;
            }
            if (trimmed.charAt(0) === "#") {
                rewritten.push(line.replace(/URI="([^"]+)"/ig, function (_, uri) {
                    const absolute = fixUrl(uri, playlistUrl);
                    return `URI="${proxifyUrlV1(absolute)}"`;
                }));
                continue;
            }
            const absoluteLine = fixUrl(trimmed, playlistUrl);
            rewritten.push(proxifyUrlV1(absoluteLine));
        }
        return "magic_m3u8:" + encodeBase64String(rewritten.join("\n"));
    }

    function proxiedHlsUrl(url, headers) {
        let mirrorHosts = [];
        try {
            mirrorHosts = [new URL(url).hostname];
        } catch (e) {
            mirrorHosts = [];
        }
        const referer = headers && (headers.Referer || headers.referer) ? (headers.Referer || headers.referer) : "";
        return proxifyUrl(url, headers || {}, referer, mirrorHosts);
    }

    function createStream(url, source, headers, quality, tag, type) {
        const stream = {
            url,
            source: streamName(source, quality, tag),
            quality: quality || undefined,
            headers: headers || { "User-Agent": UA }
        };
        if (type) stream.type = type;
        if (stream.headers && (stream.headers.Referer || stream.headers.referer)) {
            stream.referer = stream.headers.Referer || stream.headers.referer;
        }
        return new StreamResult(stream);
    }

    async function getText(url, headers) {
        const res = await http_get(url, headers || HEADERS);
        return res && res.body ? res.body : "";
    }

    async function postText(url, headers, body) {
        try {
            const res = await http_post(url, headers, body);
            return res && res.body ? res.body : "";
        } catch (e) {
            const res = await http_post(url, body, headers);
            return res && res.body ? res.body : "";
        }
    }

    async function mapLimit(items, limit, worker) {
        const list = items || [];
        const output = new Array(list.length);
        let cursor = 0;
        async function run() {
            while (cursor < list.length) {
                const index = cursor++;
                try {
                    output[index] = await worker(list[index], index);
                } catch (e) {
                    output[index] = null;
                }
            }
        }
        const workers = [];
        for (let i = 0; i < Math.min(limit, list.length); i++) workers.push(run());
        await Promise.all(workers);
        return output;
    }

    function flatten(items) {
        const out = [];
        for (const item of items || []) {
            if (!item) continue;
            if (Array.isArray(item)) out.push.apply(out, item.filter(Boolean));
            else out.push(item);
        }
        return out;
    }

    function dedupeStreams(streams) {
        const seen = {};
        return (streams || []).filter((stream) => {
            const key = `${stream.url}|${stream.source}`;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function homeUrl(path, page) {
        if (path.indexOf("/?type=") >= 0) {
            const parts = path.split("/?type=");
            return `${MAIN_URL}/${parts[0]}/page/${page || 1}/?type=${parts[1]}`;
        }
        return `${MAIN_URL}/${path}/page/${page || 1}`;
    }

    function toMedia(element, fallbackType, base) {
        const title = text((qs(element, "header h2") || qs(element, "h2") || qs(element, "h3"))?.textContent);
        const link = qs(element, "a");
        const href = fixUrl(attr(link, ["href"]), base || MAIN_URL);
        if (!title || !href) return null;
        const poster = getImageAttr(qs(element, "img"), href);
        const type = detectType(href, fallbackType);
        return new MultimediaItem({
            title,
            url: payload(href, poster, type),
            posterUrl: poster,
            type
        });
    }

    function toRecommendation(element, base) {
        const link = qs(element, "a");
        const href = fixUrl(attr(link, ["href"]), base || MAIN_URL);
        if (!href) return null;
        const title = text((qs(element, "header h2") || qs(element, "h2") || qs(element, "h3"))?.textContent);
        const poster = getImageAttr(qs(element, "img"), href);
        return new MultimediaItem({
            title,
            url: payload(href, poster, detectType(href)),
            posterUrl: poster,
            type: detectType(href)
        });
    }

    async function parseArticleList(html, type, base) {
        const doc = await parseHtml(html || "");
        return qsa(doc, "article").map((article) => toMedia(article, type, base)).filter(Boolean);
    }

    async function getHome(cb) {
        try {
            const sectionResults = await mapLimit(HOME_SECTIONS, 6, async (section) => {
                const html = await getText(homeUrl(section.path, 1), HEADERS);
                const items = await parseArticleList(html, section.type, MAIN_URL);
                return { name: section.name, items };
            });
            const data = {};
            for (const section of sectionResults) {
                if (section && section.items && section.items.length) data[section.name] = section.items;
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HTTP_ERROR", message: e.message || String(e) });
        }
    }

    async function search(query, cb) {
        try {
            const body = [
                "action=torofilm_infinite_scroll",
                "page=1",
                "per_page=12",
                "query_type=search",
                `query_args[s]=${encodeURIComponent(query)}`
            ].join("&");
            const response = await postText(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
                ...HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": `${MAIN_URL}/`
            }, body);
            const json = safeParse(response);
            const content = json && json.data && json.data.content ? json.data.content : "";
            const items = content ? await parseArticleList(content, "series", MAIN_URL) : [];
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    function collectTags(doc) {
        const tags = [];
        for (const header of qsa(doc, "h4")) {
            const label = text(header.textContent);
            if (!/Genres|Languages/i.test(label)) continue;
            const next = header.nextElementSibling;
            for (const link of qsa(next, "a")) {
                const value = text(link.textContent);
                if (value && tags.indexOf(value) < 0) tags.push(value);
            }
        }
        return tags;
    }

    function parseYear(doc) {
        const candidates = qsa(doc, "div, span, a").map((el) => text(el.textContent));
        for (const value of candidates) {
            const match = value.match(/^(19|20)\d{2}$/);
            if (match) return parseInt(value, 10);
        }
        return undefined;
    }

    function seasonNumber(button, index) {
        const raw = attr(button, ["data-season", "data-num", "data-id"]) || text(button.textContent);
        const found = String(raw).match(/\d+/);
        return found ? parseInt(found[0], 10) : index + 1;
    }

    function episodeNumber(index) {
        return index + 1;
    }

    function episodeName(rawName, index) {
        const number = episodeNumber(index);
        return String(rawName || "").indexOf(`x${number}`) >= 0 ? `Episode ${number}` : rawName;
    }

    async function loadSeason(button, seasonIndex, parentPoster) {
        const postId = attr(button, ["data-post", "data-id", "data-post-id"]);
        const dataSeason = attr(button, ["data-season", "data-num"]) || String(seasonNumber(button, seasonIndex));
        if (!postId || !dataSeason) return [];
        const body = `action=action_select_season&season=${encodeURIComponent(dataSeason)}&post=${encodeURIComponent(postId)}`;
        const html = await postText(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
            ...HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${MAIN_URL}/`
        }, body);
        const doc = await parseHtml(html);
        const season = seasonNumber(button, seasonIndex);
        return qsa(doc, "li article, article").map((article, index) => {
            const link = qs(article, "a");
            const href = fixUrl(attr(link, ["href"]), MAIN_URL);
            if (!href) return null;
            const rawName = text((qs(article, "h2.entry-title") || qs(article, "h2") || qs(article, "h3"))?.textContent) || `Episode ${index + 1}`;
            const name = episodeName(rawName, index);
            const poster = getImageAttr(qs(article, "img"), href) || parentPoster || "";
            return new Episode({
                name,
                url: payload(href, poster, "episode"),
                posterUrl: poster,
                season,
                episode: episodeNumber(index)
            });
        }).filter(Boolean);
    }

    async function load(urlStr, cb) {
        try {
            const media = inputPayload(urlStr);
            if (!media.url) throw new Error("Invalid URL data");
            const html = await getText(media.url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const doc = await parseHtml(html);
            const title = text((qs(doc, "h1") || qs(doc, "header h1"))?.textContent) || "No Title";
            const poster = getImageAttr(qs(doc, "div.bd > div:nth-child(1) > img") || qs(doc, ".post-thumbnail img") || qs(doc, "article img"), media.url) || media.poster || "";
            const description = text((qs(doc, "#overview-text p") || qs(doc, ".description p") || qs(doc, ".entry-content p"))?.textContent);
            const type = detectType(media.url, media.type);
            const tags = collectTags(doc);
            const year = parseYear(doc);
            const recommendations = qsa(doc, "#single_relacionados article, .related article")
                .map((article) => toRecommendation(article, media.url))
                .filter((item) => item && item.url !== urlStr)
                .slice(0, 24);

            if (type === "series") {
                const buttons = qsa(doc, "div.season-buttons a, .toro-season-button");
                const loaded = await mapLimit(buttons, 4, (button, index) => loadSeason(button, index, poster));
                const episodes = flatten(loaded);
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url: payload(media.url, poster, "series"),
                        posterUrl: poster,
                        description,
                        type: "series",
                        year,
                        tags,
                        episodes,
                        recommendations
                    })
                });
                return;
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url: payload(media.url, poster, "movie"),
                    posterUrl: poster,
                    description,
                    type: "movie",
                    year,
                    tags,
                    episodes: [new Episode({
                        name: title,
                        url: payload(media.url, poster, "movie"),
                        posterUrl: poster
                    })],
                    recommendations
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
        }
    }

    function parseHlsAttributes(line) {
        const attrs = {};
        const source = String(line || "");
        let i = 0;
        while (i < source.length) {
            while (i < source.length && /[\s,]/.test(source[i])) i++;
            let key = "";
            while (i < source.length && source[i] !== "=" && source[i] !== ",") key += source[i++];
            if (!key || source[i] !== "=") {
                i++;
                continue;
            }
            i++;
            let value = "";
            if (source[i] === "\"") {
                i++;
                while (i < source.length) {
                    if (source[i] === "\"" && source[i - 1] !== "\\") {
                        i++;
                        break;
                    }
                    value += source[i++];
                }
            } else {
                while (i < source.length && source[i] !== ",") value += source[i++];
            }
            attrs[key.trim().toUpperCase()] = value.trim();
            while (i < source.length && source[i] !== ",") i++;
            if (source[i] === ",") i++;
        }
        return attrs;
    }

    function parseResolution(attrs) {
        const res = attrs.RESOLUTION || "";
        const match = res.match(/x(\d+)/i);
        return match ? parseInt(match[1], 10) : 0;
    }

    function resolveUrl(line, baseUrl) {
        return fixUrl(line, baseUrl);
    }

    function serializeHlsValue(value) {
        const str = String(value == null ? "" : value);
        if (/^-?\d+(?:\.\d+)?$/.test(str) || str === "YES" || str === "NO" || str === "NONE") return str;
        return `"${str.replace(/"/g, "\\\"")}"`;
    }

    function serializeHlsAttributes(attrs) {
        const parts = [];
        for (const key of Object.keys(attrs || {})) {
            if (attrs[key] == null || attrs[key] === "") continue;
            parts.push(`${key}=${serializeHlsValue(attrs[key])}`);
        }
        return parts.join(",");
    }

    function parseHlsMasterPlaylist(master, masterUrl) {
        const lines = String(master || "").split(/\r?\n/);
        const media = { AUDIO: {}, SUBTITLES: {}, "CLOSED-CAPTIONS": {} };
        const variants = [];
        let current = null;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith("#EXT-X-MEDIA:")) {
                const attrs = parseHlsAttributes(line.substring("#EXT-X-MEDIA:".length));
                const type = attrs.TYPE;
                const group = attrs["GROUP-ID"];
                if (type && group && media[type]) {
                    if (attrs.URI) attrs.URI = resolveUrl(attrs.URI, masterUrl);
                    if (!media[type][group]) media[type][group] = [];
                    media[type][group].push(attrs);
                }
                continue;
            }
            if (line.startsWith("#EXT-X-STREAM-INF:")) {
                current = parseHlsAttributes(line.substring("#EXT-X-STREAM-INF:".length));
                continue;
            }
            if (current && !line.startsWith("#")) {
                const variantUrl = resolveUrl(line, masterUrl);
                const quality = parseResolution(current) || qualityFromText(variantUrl, 0);
                variants.push({ attrs: current, url: variantUrl, quality });
                current = null;
            }
        }
        return { variants, media };
    }

    function appendMediaGroupLines(lines, media, type, groupId) {
        if (!groupId || !media[type] || !media[type][groupId]) return false;
        for (const attrs of media[type][groupId]) {
            lines.push(`#EXT-X-MEDIA:${serializeHlsAttributes(attrs)}`);
        }
        return true;
    }

    async function expandHlsStreams(url, source, headers, fallbackQuality) {
        const resolvedHeaders = headers || { "User-Agent": UA };
        try {
            const body = await getText(url, resolvedHeaders);
            if (!/#EXTM3U/i.test(body) || !/#EXT-X-STREAM-INF/i.test(body)) {
                return [createStream(proxifyUrl(url, resolvedHeaders, resolvedHeaders.Referer || resolvedHeaders.referer || "", [getHost(url)].filter(Boolean)), source, {}, fallbackQuality || qualityFromText(url, 0), "adaptive", "hls")];
            }
            const parsed = parseHlsMasterPlaylist(body, url);
            const bestQuality = parsed.variants.reduce((max, variant) => Math.max(max, variant.quality || 0), fallbackQuality || 0);
            return [createStream(proxifyUrl(url, resolvedHeaders, resolvedHeaders.Referer || resolvedHeaders.referer || "", [getHost(url)].filter(Boolean)), source, {}, bestQuality || fallbackQuality || 0, "adaptive", "hls")];
        } catch (e) {
            return [createStream(proxifyUrl(url, resolvedHeaders, resolvedHeaders.Referer || resolvedHeaders.referer || "", [getHost(url)].filter(Boolean)), source, {}, fallbackQuality || qualityFromText(url, 0), "adaptive", "hls")];
        }
    }

    async function addMediaUrl(streams, mediaUrl, source, headers, fallbackQuality, tag) {
        if (!mediaUrl) return;
        const url = fixUrl(mediaUrl);
        if (/\.m3u8(?:\?|$)/i.test(url)) {
            streams.push.apply(streams, await expandHlsStreams(url, source, headers, fallbackQuality));
            return;
        }
        streams.push(createStream(url, source, headers, fallbackQuality || qualityFromText(url, 0), tag));
    }

    function findJsonSource(data) {
        if (!data) return "";
        if (typeof data === "string") return data;
        if (data.file) return data.file;
        if (data.url) return data.url;
        if (data.sources) return findJsonSource(data.sources);
        if (Array.isArray(data)) {
            for (const item of data) {
                const found = findJsonSource(item);
                if (found) return found;
            }
        }
        return "";
    }

    async function extractAWSStream(url, source) {
        const streams = [];
        try {
            const parsed = new URL(url);
            const baseUrl = parsed.origin;
            const hash = parsed.pathname.split("/").filter(Boolean).pop() || "";
            await getText(url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const api = `${baseUrl}/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
            const response = await postText(api, {
                ...HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": url
            }, `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(baseUrl)}`);
            const data = safeParse(response);
            const mediaUrl = data && (data.videoSource || data.securedLink || data.hls);
            await addMediaUrl(streams, mediaUrl, source, { "User-Agent": UA, "Referer": "" }, 1080);
        } catch (e) {
            console.error(`${source} Error:`, e.message || String(e));
        }
        return streams;
    }

    async function extractMegaPlay(url, source) {
        const streams = [];
        try {
            const parsed = new URL(url);
            const baseUrl = parsed.origin;
            const page = await getText(url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const doc = await parseHtml(page);
            const id = attr(qs(doc, "#megaplay-player"), ["data-id"]) || (page.match(/data-id=["']([^"']+)["']/i) || [])[1];
            if (!id) return streams;
            const api = `${baseUrl}/stream/getSources?id=${encodeURIComponent(id)}&id=${encodeURIComponent(id)}`;
            const response = await getText(api, {
                ...HEADERS,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": baseUrl,
                "Referer": url
            });
            const data = safeParse(response);
            const mediaUrl = findJsonSource(data && data.sources);
            await addMediaUrl(streams, mediaUrl, source, {
                "User-Agent": UA,
                "Accept": "*/*",
                "Origin": baseUrl,
                "Referer": `${baseUrl}/`
            }, 1080);
        } catch (e) {
            console.error(`${source} Error:`, e.message || String(e));
        }
        return streams;
    }

    async function extractFilesim(url, source) {
        const streams = [];
        try {
            const page = await getText(url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const candidates = [];
            const regexes = [
                /file\s*:\s*["']([^"']+)["']/ig,
                /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/ig,
                /(https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)/ig,
                /(https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*)/ig
            ];
            for (const regex of regexes) {
                let match;
                while ((match = regex.exec(page)) !== null) candidates.push(match[1]);
            }
            for (const candidate of candidates) {
                await addMediaUrl(streams, candidate.replace(/\\\//g, "/"), source, {
                    "User-Agent": UA,
                    "Referer": url
                }, qualityFromText(candidate, 720));
            }
        } catch (e) {
            console.error(`${source} Error:`, e.message || String(e));
        }
        return dedupeStreams(streams);
    }

    async function extractAbyss(url, source) {
        const streams = [];
        try {
            const abyssHeaders = {
                "User-Agent": UA,
                "Origin": "https://playhydrax.com",
                "Referer": "https://playhydrax.com/"
            };
            const page = await getText(url, abyssHeaders);
            const encrypted = (page.match(/const\s+datas\s*=\s*"([^"]+)"/) || [])[1];
            if (!encrypted) return streams;
            const response = await postText("https://enc-dec.app/api/dec-abyss", {
                ...abyssHeaders,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }, JSON.stringify({ text: encrypted }));
            const decoded = safeParse(response);
            const sources = decoded && decoded.result && decoded.result.sources ? decoded.result.sources : [];
            for (const item of sources) {
                if (!item || item.status === false) continue;
                const mediaUrl = item.url || item.file;
                const codec = item.codec ? String(item.codec).toUpperCase() : "";
                const quality = qualityFromText(item.type || item.name || mediaUrl, 0);
                await addMediaUrl(streams, mediaUrl, source, abyssHeaders, quality, codec);
            }
        } catch (e) {
            console.error(`${source} Error:`, e.message || String(e));
        }
        return streams;
    }

    async function extractAnimesaltMulti(url) {
        const streams = [];
        try {
            const page = await getText(url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const doc = await parseHtml(page);
            const iframe = qs(doc, "iframe");
            const src = fixUrl(attr(iframe, ["data-src", "src"]), url);
            if (src && src !== url) streams.push.apply(streams, await loadExtractor(src, url));
        } catch (e) {
            console.error("Animesalt Multi Error:", e.message || String(e));
        }
        return streams;
    }

    async function loadExtractor(url, referer) {
        const fixed = fixUrl(url, referer || MAIN_URL);
        if (!fixed) return [];
        const host = getHost(fixed);
        if (/\.m3u8(?:\?|$)/i.test(fixed)) return expandHlsStreams(fixed, host || "HLS", { "User-Agent": UA, "Referer": referer || `${MAIN_URL}/` });
        if (/\.mp4(?:\?|$)/i.test(fixed)) return [createStream(fixed, host || "MP4", { "User-Agent": UA, "Referer": referer || `${MAIN_URL}/` }, qualityFromText(fixed, 0))];
        if (host === "animesalt.ac") return extractAnimesaltMulti(fixed);
        if (/z\.awstream\.net|beta\.awstream\.net/i.test(host)) return extractAWSStream(fixed, "AWSStream");
        if (/play\.zephyrflick\.top|as-cdn21\.top/i.test(host)) return extractAWSStream(fixed, "Zephyrflick");
        if (/rapid-cloud\.co/i.test(host)) return extractMegaPlay(fixed, "Rapid");
        if (/megaplay\.buzz/i.test(host)) return extractMegaPlay(fixed, "MegaPlay");
        if (/abyssplayer\.com|playhydrax\.com/i.test(host)) return extractAbyss(fixed, "Abyass");
        if (/short\.icu/i.test(host)) return extractAbyss(fixed, "Short");
        if (/pixdrive\.cfd/i.test(host)) return extractFilesim(fixed, "Pixdrive");
        if (/ghbrisk\.com|streamwish|filelions/i.test(host)) return extractFilesim(fixed, "Streamwish");
        if (/vidmoly/i.test(host)) return extractFilesim(fixed, "VidMoly");
        return [createStream(fixed, host || "Server", { "User-Agent": UA, "Referer": referer || `${MAIN_URL}/` }, qualityFromText(fixed, 0))];
    }

    async function loadStreams(urlInfo, cb) {
        try {
            const media = inputPayload(urlInfo);
            if (!media.url) throw new Error("Invalid URL data");
            const html = await getText(media.url, { ...HEADERS, "Referer": `${MAIN_URL}/` });
            const doc = await parseHtml(html);
            const iframeUrls = qsa(doc, "#options-0 iframe, iframe")
                .map((iframe) => fixUrl(attr(iframe, ["data-src", "src"]), media.url))
                .filter(Boolean);
            const loaded = await mapLimit(iframeUrls, 6, (src) => loadExtractor(src, media.url));
            cb({ success: true, data: dedupeStreams(flatten(loaded)) });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
