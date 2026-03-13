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

    const YflixHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Referer": `${manifest.baseUrl}/`
    };

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return manifest.baseUrl + url;
        return url;
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/\\u003C/g, "<").replace(/\\u003E/g, ">").replace(/\\u0022/g, "\"").replace(/\\u0027/g, "'").replace(/\\u0026/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#039;/g, "'").replace(/&amp;/g, "&");
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
            if (url) items.push(new MultimediaItem({ 
                title, 
                url, 
                posterUrl: poster,
                type: url.includes("/tv/") ? "series" : "movie"
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
            return JSON.parse(res.body)?.result?.url || "";
        } catch { return ""; }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, YflixHeaders);
            if (!res || res.status !== 200 || !res.body) return cb({ success: false, errorCode: "SITE_OFFLINE" });
            
            const doc = new JsoupLite(res.body);
            const title = doc.find("h1.title")?.textContent()?.trim() || "Unknown";
            const posterImgWrap = doc.find('div.detailWrap');
            const poster = fixUrl(posterImgWrap?.find("img")?.attr("src") || "");
            const description = doc.find("div.description")?.textContent()?.trim() || "";
            const dataId = doc.find("#movie-rating")?.attr("data-id") || "";
            const keyword = url.split("/watch/")[1]?.split(".")[0] || "";

            const decoded = await decode(dataId);
            const epUrl = `${manifest.baseUrl}/ajax/episodes/list?keyword=${keyword}&id=${dataId}&_=${decoded}`;
            const epRes = await http_get(epUrl, YflixHeaders);
            
            if (!epRes || epRes.status !== 200 || !epRes.body) return cb({ success: false, errorCode: "PARSE_ERROR" });
            
            const epJson = JSON.parse(epRes.body);
            const html = epJson.result || "";
            const epDoc = new JsoupLite(html);
            const episodeLinks = epDoc.select("ul.episodes a");
            
            const isTv = url.includes("/tv/");
            const episodes = [];

            if (episodeLinks.length === 1 && episodeLinks[0].textContent().toLowerCase().includes("movie")) {
                episodes.push(new Episode({ 
                    name: "Full Movie", 
                    season: 1, 
                    episode: 1, 
                    posterUrl: poster, 
                    url: JSON.stringify([{ name: "Full Movie", links: [{ name: "Play", url: episodeLinks[0].attr("eid") }] }]) 
                }));
            } else {
                epDoc.select("ul.episodes").forEach(seasonBlock => {
                    const season = parseInt(seasonBlock.attr("data-season")) || 1;
                    seasonBlock.select("a").forEach((epEl, idx) => {
                        const eid = epEl.attr("eid");
                        if (eid) {
                            episodes.push(new Episode({ 
                                name: `Episode ${parseInt(epEl.attr("num")) || (idx + 1)}`, 
                                season, 
                                episode: parseInt(epEl.attr("num")) || (idx + 1), 
                                posterUrl: poster, 
                                url: JSON.stringify([{ name: `Episode ${parseInt(epEl.attr("num")) || (idx + 1)}`, links: [{ name: "Play", url: eid }] }]) 
                            }));
                        }
                    });
                });
            }

            cb({ success: true, data: new MultimediaItem({
                title, url, posterUrl: poster, description, type: isTv ? "series" : "movie", episodes
            })});
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    async function extractMegaUp(url, referer, quality) {
        try {
            const mediaUrl = url.replace("/e2/", "/media/").replace("/e/", "/media/");
            const res = await http_get(mediaUrl, { "User-Agent": YflixHeaders["User-Agent"], "Referer": manifest.baseUrl });
            const encoded = JSON.parse(res.body).result;
            if (!encoded) return [];
            
            const postRes = await http_post(KAIMEG, { "Content-Type": "application/json" }, JSON.stringify({ text: encoded, agent: YflixHeaders["User-Agent"] }));
            const result = JSON.parse(postRes.body).result;
            if (result && result.sources && result.sources[0]) {
                const m3u8 = typeof result.sources[0] === "string" ? result.sources[0] : result.sources[0].file;
                if (m3u8) return [new StreamResult({ url: m3u8, source: (referer || "MegaUp") + " 1080p", headers: { "Referer": manifest.baseUrl } })];
            }
        } catch {}
        return [];
    }

    async function loadStreams(dataStr, cb) {
        try {
            const data = JSON.parse(dataStr);
            const results = [];
            
            for (const item of data) {
                for (const link of item.links) {
                    const eid = link.url;
                    const decodedEid = await decode(eid);
                    if (!decodedEid) continue;
                    
                    const listRes = await http_get(`${manifest.baseUrl}/ajax/links/list?eid=${eid}&_=${decodedEid}`, YflixHeaders);
                    if (!listRes || !listRes.body) continue;
                    
                    const listData = JSON.parse(listRes.body);
                    const html = decodeHtml(listData.result || "");
                    const servers = new JsoupLite(html).select("li.server");
                    
                    for (const server of servers) {
                        const lid = server.attr("data-lid"), serverName = server.find("span")?.textContent() || "Server";
                        if (!lid) continue;
                        
                        const decodedLid = await decode(lid);
                        if (!decodedLid) continue;
                        
                        const viewRes = await http_get(`${manifest.baseUrl}/ajax/links/view?id=${lid}&_=${decodedLid}`, YflixHeaders);
                        if (!viewRes || !viewRes.body) continue;
                        
                        const viewData = JSON.parse(viewRes.body);
                        const result = viewData.result || "";
                        if (!result) continue;
                        
                        const videoUrl = await decodeReverse(result);
                        if (!videoUrl) continue;
                        
                        if (videoUrl.toLowerCase().includes("rapidshare")) {
                            const extracted = await extractMegaUp(videoUrl, "⌜ Yflix ⌟ | " + serverName, null);
                            results.push(...extracted);
                        }
                    }
                }
            }
            cb({ success: true, data: results });
        } catch { 
            cb({ success: false, errorCode: "PARSE_ERROR" }); 
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
