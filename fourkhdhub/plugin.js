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
            if (selector.includes(".")) {
                const parts = selector.split(".");
                const t = parts[0];
                const c = parts[1];
                const tagMatch = !t || this.tag === t.toLowerCase();
                const classMatch = (this.attrs.class || "").split(/\s+/).includes(c);
                return tagMatch && classMatch;
            }
            if (selector.startsWith("#")) return this.attrs.id === selector.slice(1);
            return this.tag === selector.toLowerCase();
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

    function cleanText(value) {
        return unescapeHTML(String(value || ""))
            .replace(/\s+/g, " ")
            .trim();
    }

    function isStreamHost(url) {
        const value = String(url || "").toLowerCase();
        return value.includes("gadgetsweb.xyz")
            || value.includes("hubcloud")
            || value.includes("hubdrive")
            || value.includes("hubcdn")
            || value.includes("drive.google.com");
    }

    function detectSourceName(url, fallback = "Auto") {
        const value = String(url || "").toLowerCase();
        if (value.includes("hubcloud")) return "HubCloud";
        if (value.includes("hubdrive")) return "HubDrive";
        if (value.includes("hubcdn")) return "HubCDN";
        if (value.includes("drive.google.com")) return "GDrive";
        if (value.includes("gadgetsweb.xyz")) return fallback;
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
        if (!href || !isStreamHost(href)) return null;

        const rawName = normalizeSourceName(anchor.textContent()) || detectSourceName(href);
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

    function compareEpisodes(a, b) {
        if ((a.season || 0) !== (b.season || 0)) return (a.season || 0) - (b.season || 0);
        if ((a.episode || 0) !== (b.episode || 0)) return (a.episode || 0) - (b.episode || 0);
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
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
            for (const cat of mainpage) {
                const url = `${manifest.baseUrl}/${cat.url}`;
                console.log(`Fetching category: ${cat.title} from ${url}`);
                const res = await http_get(url, CommonHeaders);
                if (res && res.body) {
                    const parsed = parseRes(res.body);
                    if (parsed.length > 0) results[cat.title] = parsed;
                } else {
                    console.error(`Failed to fetch ${url}`);
                }
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
            const title = doc.find("h1")?.textContent()?.split("(")[0].trim() || "Unknown";
            let poster = null;
            doc.select("meta").forEach(m => { if (m.attr("property") === "og:image") poster = fixUrl(m.attr("content")); });
            
            const descriptionEl = doc.find(".movie-description") || doc.select(".content-main p").find(p => p.textContent().length > 50);
            let description = descriptionEl ? stripHTML(descriptionEl.textContent()) : "";
            
            if (!description || description.length < 10) {
                doc.select("meta").forEach(m => { 
                    if (m.attr("name") === "description" || m.attr("property") === "og:description") {
                        const content = m.attr("content");
                        if (content && content.length > description.length) description = unescapeHTML(content);
                    }
                });
            }
            
            const isSeries = url.includes("-series-") || doc.root.textContent().includes("Download Individual Episodes") || !!doc.find(".episode-download-item");

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
                    const linksRegex = /href="(https?:\/\/(?:gadgetsweb\.xyz|hubcloud|hubdrive|hubcdn|drive\.google\.com)[^"]+)"/gi;
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
                        title, 
                        url, 
                        posterUrl: poster, 
                        description, 
                        type: "movie",
                        episodes: [new Episode({ 
                            name: "Full Movie", 
                            season: 1, 
                            episode: 1, 
                            url: JSON.stringify(movieGroups), 
                            posterUrl: poster 
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
                        links
                    });
                    maxEpisodePerSeason[seasonNum] = nextEpisode;
                });

                const episodes = Array.from(episodesMap.values())
                    .sort(compareEpisodes)
                    .map(item => new Episode({
                        name: item.name,
                        season: item.season,
                        episode: item.episode,
                        url: JSON.stringify([{ name: item.name, links: item.links }]),
                        posterUrl: poster
                    }));

                if (episodes.length === 0) {
                    doc.select("a").forEach(a => {
                        const href = a.attr("href");
                        if (href && (href.includes("episode") || href.includes("season"))) {
                            episodes.push(new Episode({
                                name: cleanText(a.textContent()),
                                url: fixUrl(href),
                                posterUrl: poster
                            }));
                        }
                    });
                }
                
                cb({ success: true, data: new MultimediaItem({ title, url, posterUrl: poster, description, type: "series", episodes }) });
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
            for (const link of queue) {
                const resolvedUrl = await resolveRedirectUrl(link.url);
                if (!resolvedUrl) continue;

                const extracted = await resolveStreamLink(resolvedUrl, link);
                extracted.forEach(result => {
                    const key = result.url;
                    if (!key || seenResults.has(key)) return;
                    seenResults.add(key);
                    results.push(result);
                });
            }

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
        if (url.includes("gadgetsweb.xyz") || url.includes("id=")) {
            return await getRedirectLinks(url);
        }
        return url;
    }

    async function resolveStreamLink(url, link) {
        if (url.includes("hubcloud") || url.includes("hubdrive")) {
            const extracted = await extractHubCloudStreams(url, link.source, link.quality);
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
            const headers = { ...CommonHeaders, "Cookie": "xla=s4t" };
            const res = await http_get(url, headers);
            if (!res || !res.body) return callback([]);
            
            const doc = new JsoupLite(res.body);
            
            // Check if we're already on a page with download buttons (like gamerxyt)
            if (url.includes("gamerxyt.com") || res.body.includes("Download Link Generated")) {
                return extractFinalButtons(res.body, callback, sourceName, qualityHint);
            }

            const nextUrl = fixUrl(doc.find("#download")?.attr("href") || "");
            if (nextUrl) {
                const res2 = await http_get(nextUrl, { ...headers, "Referer": url });
                if (res2 && res2.body) {
                    return extractFinalButtons(res2.body, callback, sourceName, qualityHint);
                }
            }
            callback([]);
        } catch { callback([]); }
    }

    function extractFinalButtons(html, callback, sourceName = "HubCloud", qualityHint = 0) {
        const doc = new JsoupLite(html);
        const extracted = [];
        const header = cleanText(doc.find(".card-header")?.textContent()) || cleanText(doc.find("h1")?.textContent());
        const quality = parseInt(qualityHint, 10) || parseQuality(header) || parseQuality(html);

        doc.select("a.btn").forEach(el => {
            const label = normalizeSourceName(el.textContent());
            const lowerLabel = label.toLowerCase();
            const link = el.attr("href");
            if (link && (lowerLabel.includes("download") || el.attr("class").includes("btn-success"))) {
                let source = sourceName;
                if (lowerLabel.includes("fsl server")) source = `${sourceName} FSL Server`;
                else if (lowerLabel.includes("buzzserver")) source = `${sourceName} BuzzServer`;
                else if (lowerLabel.includes("pixel")) source = `${sourceName} Pixeldrain`;
                else if (lowerLabel.includes("s3 server")) source = `${sourceName} S3 Server`;
                else if (lowerLabel.includes("fslv2")) source = `${sourceName} FSLv2`;
                else if (lowerLabel.includes("mega server")) source = `${sourceName} Mega Server`;
                else if (lowerLabel.includes("pdl server")) source = `${sourceName} PDL Server`;
                else if (label && !lowerLabel.includes("download file")) source = `${sourceName} ${label}`;

                extracted.push({
                    url: fixUrl(link),
                    source: sourceWithQuality(source, quality),
                    quality: quality || undefined
                });
            }
        });
        callback(extracted);
    }

    // Export to global scope
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
