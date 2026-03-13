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
            const re = /<\/?[a-z0-0-]+(?:\s+[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+/gi;
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
                    if (!selfClosing) current = node;
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

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return manifest.baseUrl + url;
        return url;
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
                console.log(`Added: ${title} (${type})`);
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
            
            const description = doc.find(".movie-description")?.textContent()?.trim() || "";
            const isSeries = url.includes("-series-") || doc.root.textContent().includes("Download Individual Episodes");

            if (!isSeries) {
                const movieLinks = doc.select("a.btn")
                    .map(a => ({ name: a.find("span")?.textContent()?.trim() || a.textContent()?.trim() || "Download", url: fixUrl(a.attr("href")) }))
                    .filter(l => l.url && (l.url.includes("gadgetsweb.xyz") || l.url.includes("hubcloud") || l.url.includes("drive")));
                
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
                            url: JSON.stringify([{ name: "Direct", links: movieLinks }]), 
                            posterUrl: poster 
                        })]
                    })
                });
            } else {
                const episodes = [];
                // Handle new series layout with collapsible episodes
                const epItems = doc.select(".episode-download-item");
                if (epItems.length > 0) {
                    epItems.forEach(item => {
                        const epTitle = item.find(".episode-file-title")?.textContent()?.trim() || "Episode";
                        const epNum = parseInt(item.find(".badge-psa")?.textContent()?.match(/Episode-(\d+)/i)?.[1]) || 1;
                        const seasonNum = parseInt(item.parent?.parent?.find(".episode-number")?.textContent()?.match(/S(\d+)/i)?.[1]) || 1;
                        const links = item.select("a.btn").map(a => ({
                            name: a.textContent().trim(),
                            url: fixUrl(a.attr("href"))
                        })).filter(l => l.url && (l.url.includes("gadgetsweb.xyz") || l.url.includes("hubcloud") || l.url.includes("drive")));

                        if (links.length > 0) {
                            episodes.push(new Episode({
                                name: epTitle,
                                season: seasonNum,
                                episode: epNum,
                                url: JSON.stringify([{ name: epTitle, links }]),
                                posterUrl: poster
                            }));
                        }
                    });
                } else {
                    // Fallback to legacy link extraction
                    doc.select("a").forEach(a => {
                        const href = a.attr("href");
                        if (href && (href.includes("episode") || href.includes("season"))) {
                            episodes.push(new Episode({
                                name: a.textContent().trim(),
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
            let data;
            try { data = JSON.parse(dataStr); } catch { data = [{ links: [{ url: dataStr, name: "Auto" }] }]; }
            const results = [];
            const queue = [];
            const seen = new Set();

            data.forEach(item => {
                if (!item || !item.links) return;
                item.links.forEach(link => {
                    if (link.url && !seen.has(link.url)) {
                        seen.add(link.url);
                        queue.push(link);
                    }
                });
            });

            if (queue.length === 0) return cb({ success: true, data: [] });

            let processed = 0;
            for (const link of queue) {
                const processUrl = async (url, name) => {
                    if (url.includes("gadgetsweb.xyz") || url.includes("id=")) {
                        const resolved = await getRedirectLinks(url);
                        if (resolved) await extractFinal(resolved, name);
                    } else {
                        await extractFinal(url, name);
                    }
                };

                const extractFinal = async (url, name) => {
                    if (url.includes("hubcloud") || url.includes("hubdrive")) {
                        await extractHubCloud(url, (extracted) => {
                            if (extracted) results.push(...extracted.map(e => new StreamResult({
                                url: e.url,
                                quality: e.quality,
                                headers: CommonHeaders
                            })));
                        });
                    } else {
                        results.push(new StreamResult({
                            url: url,
                            quality: name || "Auto",
                            headers: CommonHeaders
                        }));
                    }
                };

                await processUrl(link.url, link.name);
                processed++;
                if (processed === queue.length) cb({ success: true, data: results });
            }
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    function base64Decode(str) {
        try {
            return Buffer.from(str, 'base64').toString('utf8');
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

    async function extractHubCloud(url, callback) {
        try {
            const headers = { ...CommonHeaders, "Cookie": "xla=s4t" };
            const res = await http_get(url, headers);
            if (!res || !res.body) return callback([]);
            
            const doc = new JsoupLite(res.body);
            
            // Check if we're already on a page with download buttons (like gamerxyt)
            if (url.includes("gamerxyt.com") || res.body.includes("Download Link Generated")) {
                return extractFinalButtons(res.body, callback);
            }

            const nextUrl = fixUrl(doc.find("#download")?.attr("href") || "");
            if (nextUrl) {
                const res2 = await http_get(nextUrl, { ...headers, "Referer": url });
                if (res2 && res2.body) {
                    return extractFinalButtons(res2.body, callback);
                }
            }
            callback([]);
        } catch { callback([]); }
    }

    function extractFinalButtons(html, callback) {
        const doc = new JsoupLite(html);
        const extracted = [];
        const qMatch = html.match(/(\d{3,4})[pP]/);
        const q = qMatch ? qMatch[1] + "p" : "HD";

        doc.select("a.btn").forEach(el => {
            const label = el.textContent().trim();
            const link = el.attr("href");
            if (link && (label.toLowerCase().includes("download") || el.attr("class").includes("btn-success"))) {
                extracted.push({ url: link, quality: label.replace(/Download|\[|\]/gi, "").trim() || q });
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
