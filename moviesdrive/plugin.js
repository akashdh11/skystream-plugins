(function() {
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
            this.ownText = "";
        }
        attr(name) { return this.attrs[name] || ""; }
        textContent() {
            if (!this.tag) return this.ownText;
            let t = "";
            for (const c of this.children) t += c.textContent();
            return t;
        }
        text() { return this.textContent(); }
        html() { return this.children.map(c => c.outerHTML()).join(""); }
        outerHTML() {
            if (!this.tag) return this.ownText;
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
        first() { return this; }
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
                const text = token.replace(/&nbsp;/g, " ").trim();
                if (text) {
                    const t = new JNode(null, {}, current);
                    t.ownText = text;
                    current.children.push(t);
                }
            }
        }
        find(selector) { return this.root.find(selector); }
        select(selector) { return this.root.select(selector); }
        static parse(html) { return new JsoupLite(html); }
    }

    const CommonHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36" };
    const MetaUrl = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";

    function fixUrl(u) {
        if (!u) return "";
        if (u.startsWith("//")) return "https:" + u;
        if (u.startsWith("/")) return manifest.baseUrl + u;
        return u;
    }

    function getQuality(t) {
        if (!t) return "Auto";
        const l = t.toLowerCase();
        if (l.includes("2160p") || l.includes("4k")) return "4K";
        if (l.includes("1080p")) return "1080p";
        if (l.includes("720p")) return "720p";
        if (l.includes("480p")) return "480p";
        return "Auto";
    }

    function unescapeHTML(str) {
        if (!str) return "";
        return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                  .replace(/&#8211;/g, "–").replace(/&#8212;/g, "—");
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

    async function extractHubCloud(url, qual) {
        try {
            const headers = { ...CommonHeaders, "Cookie": "xla=s4t" };
            const res = await http_get(url, headers);
            if (!res || !res.body) return [];
            
            // Check if we're already on a page with download buttons (like gamerxyt)
            if (url.includes("gamerxyt.com") || res.body.includes("Download Link Generated")) {
                return extractFinalButtons(res.body, qual);
            }

            const doc = JsoupLite.parse(res.body);
            const nextUrl = fixUrl(doc.find("#download")?.attr("href") || "");
            if (nextUrl) {
                const res2 = await http_get(nextUrl, { ...headers, "Referer": url });
                if (res2 && res2.body) {
                    return extractFinalButtons(res2.body, qual);
                }
            }
        } catch {}
        return [];
    }

    function extractFinalButtons(html, qual) {
        const doc = JsoupLite.parse(html);
        const results = [];
        const links = doc.select("a");
        links.forEach(link => {
            const href = fixUrl(link.attr("href"));
            const text = link.text().toLowerCase();
            const isBtn = (link.attr("class") || "").includes("btn");
            if (isBtn && (text.includes("fsl server") || text.includes("fslv2") || text.includes("download file") || text.includes("s3 server") || text.includes("mega server") || text.includes("10gbps"))) {
                results.push({ url: href, name: "HubCloud", quality: qual, info: link.text().trim() });
            } else if (text.includes("pixeldrain") || text.includes("pixel server")) {
                const idMatch = /\/u\/([a-zA-Z0-9]+)/.exec(href);
                if (idMatch) results.push({ url: `https://pixeldrain.com/api/file/${idMatch[1]}?download`, name: "PixelDrain", quality: qual });
            }
        });
        return results;
    }

    async function getHome(cb) {
        const cats = [
            { title: "Home", url: "/page/" },
            { title: "Prime Video", url: "/category/amzn-prime-video/page/" },
            { title: "Netflix", url: "/category/netflix/page/" },
            { title: "Hotstar", url: "/category/hotstar/page/" }
        ];
        
        try {
            const results = {};
            for (const cat of cats) {
                const res = await http_get(`${manifest.baseUrl}${cat.url}1`, CommonHeaders);
                if (res && res.body) {
                    const doc = JsoupLite.parse(res.body);
                    const items = [];
                    // Support both common selector sets
                    let cards = doc.select("a.movie-card").length > 0 ? doc.select("a.movie-card") : doc.select(".poster-card");
                    
                    if (cards.length === 0) {
                        // Very broad regex fallback
                        const cardRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?(?:movie-card|poster-card)[\s\S]*?)<\/a>/gi;
                        let cm;
                        while ((cm = cardRe.exec(res.body))) {
                            const href = fixUrl(cm[1]);
                            const content = cm[2];
                            const titleMatch = /<(?:p|h\d)[^>]*class="(?:poster-title|entry-title|title)"[^>]*>([\s\S]*?)<\/(?:p|h\d)>/.exec(content) || /<(?:p|h\d)>([\s\S]*?)<\/(?:p|h\d)>/.exec(content);
                            const imgMatch = /<img[^>]+src="([^"]+)"/.exec(content);
                            
                            const title = unescapeHTML((titleMatch ? titleMatch[1] : "").replace(/<[^>]+>/g, "").replace("Download ", "").trim());
                            const poster = imgMatch ? fixUrl(imgMatch[1]) : "";
                            
                            if (href && title && !href.includes("javascript")) {
                                items.push(new MultimediaItem({
                                    title,
                                    url: href,
                                    posterUrl: poster,
                                    type: title.toLowerCase().includes("episode") ? "tvseries" : "movie"
                                }));
                            }
                        }
                    } else {
                        cards.forEach(card => {
                            // If card is the div, find parent a. If card is the a, it is the link.
                            const link = (card.tag === "a" ? card : card.parent && card.parent.tag === "a" ? card.parent : card.select("a")[0]);
                            if (!link) return;
                            
                            const href = fixUrl(link.attr("href"));
                            const img = card.find("img");
                            const titleEl = card.find(".poster-title") || card.find("p") || card.find("h2") || card.find("h3");
                            
                            const title = unescapeHTML((titleEl ? titleEl.text() : "").replace("Download ", "").trim());
                            const poster = img ? fixUrl(img.attr("src")) : "";
                            
                            if (href && title && !href.includes("javascript")) {
                                items.push(new MultimediaItem({
                                    title,
                                    url: href,
                                    posterUrl: poster,
                                    type: title.toLowerCase().includes("episode") ? "tvseries" : "movie"
                                }));
                            }
                        });
                    }
                    if (items.length > 0) results[cat.title] = items;
                }
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            // Use the site's JSON search API
            const res = await http_get(`${manifest.baseUrl}/searchapi.php?q=${encodeURIComponent(query)}&page=1`, CommonHeaders);
            if (res && res.body) {
                const data = JSON.parse(res.body);
                const items = [];
                if (data.hits && Array.isArray(data.hits)) {
                    data.hits.forEach(hit => {
                        const d = hit.document;
                        const title = unescapeHTML((d.post_title || "").replace("Download ", "").trim());
                        const href = fixUrl(d.permalink);
                        const poster = fixUrl(d.post_thumbnail);
                        
                        if (href && title) {
                            items.push(new MultimediaItem({
                                title,
                                url: href,
                                posterUrl: poster,
                                type: (title.toLowerCase().includes("episode") || title.toLowerCase().includes("season")) ? "tvseries" : "movie"
                            }));
                        }
                    });
                }
                return cb({ success: true, data: items });
            }
            cb({ success: true, data: [] });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, CommonHeaders);
            if (!res || !res.body) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load page" });
            
            const doc = JsoupLite.parse(res.body);
            let title = (doc.find("title")?.text() || "").replace(" - MoviesDrive", "").replace("Download ", "").trim();
            let poster = fixUrl(doc.find("img")?.attr("src"));
            const imdbMatch = res.body.match(/imdb\.com\/title\/(tt\d+)/);
            const imdbId = imdbMatch ? imdbMatch[1] : "";
            const isSeries = title.toLowerCase().includes("episode") || /season\s*\d+/i.test(title);
            
            let desc = "";
            if (imdbId) {
                const metaRes = await http_get(`${MetaUrl}/${isSeries ? "series" : "movie"}/${imdbId}.json`, CommonHeaders);
                if (metaRes && metaRes.body) {
                    try {
                        const m = JSON.parse(metaRes.body).meta;
                        desc = m.description || "";
                        poster = m.poster || poster;
                    } catch {}
                }
            }

            const episodes = [];
            const buttons = doc.select("h5").map(h5 => h5.find("a")).filter(a => a !== null);
            
            for (const btn of buttons) {
                const btnText = btn.text();
                const btnHref = fixUrl(btn.attr("href"));
                const qual = getQuality(btnText);
                
                const sRes = await http_get(btnHref, CommonHeaders);
                if (sRes && sRes.body) {
                    const sDoc = JsoupLite.parse(sRes.body);
                    const links = sDoc.select("a");
                    
                    links.forEach(l => {
                        const href = fixUrl(l.attr("href"));
                        const lText = l.text().toLowerCase();
                        if (href.match(/hubcloud|gdflix|gdlink/i) || lText.includes("hubcloud")) {
                            if (isSeries) {
                                const seaMatch = /(?:Season|S)\s*(\d+)/i.exec(btnText);
                                const sea = seaMatch ? parseInt(seaMatch[1]) : 1;
                                const eNumMatch = /(?:Ep|Episode)\s*(\d+)/i.exec(lText) || /(?:Ep|Episode)\s*(\d+)/i.exec(sRes.body.substring(Math.max(0, sRes.body.indexOf(l.outerHTML()) - 500), sRes.body.indexOf(l.outerHTML())));
                                const eNum = eNumMatch ? parseInt(eNumMatch[1]) : (episodes.length + 1);
                                
                                let ex = episodes.find(e => e.season === sea && e.episode === eNum);
                                if (!ex) {
                                    ex = new Episode({
                                        name: `Episode ${eNum}`,
                                        season: sea,
                                        episode: eNum,
                                        posterUrl: poster,
                                        url: "[]"
                                    });
                                    episodes.push(ex);
                                }
                                let linksArr = JSON.parse(ex.url);
                                if (!Array.isArray(linksArr)) linksArr = [];
                                linksArr.push({ source: href, quality: qual });
                                ex.url = JSON.stringify(linksArr);
                            } else {
                                if (episodes.length === 0) {
                                    episodes.push(new Episode({ name: "Full Movie", season: 1, episode: 1, url: "[]", posterUrl: poster }));
                                }
                                let linksArr = JSON.parse(episodes[0].url);
                                linksArr.push({ source: href, quality: qual });
                                episodes[0].url = JSON.stringify(linksArr);
                            }
                        }
                    });
                }
            }

            if (episodes.length === 0) return cb({ success: false, errorCode: "PARSE_ERROR", message: "No download links found" });

            episodes.sort((a,b) => (a.season - b.season) || (a.episode - b.episode));
            
            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url,
                    posterUrl: poster,
                    description: desc,
                    type: isSeries ? "tvseries" : "movie",
                    episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const sources = JSON.parse(dataStr);
            if (!Array.isArray(sources)) return cb({ success: true, data: [] });
            
            const results = [];
            for (const item of sources) {
                const u = item.source;
                const q = item.quality || "HD";
                if (u.includes("hubcloud") || u.includes("gdflix") || u.includes("gdlink")) {
                    const links = await extractHubCloud(u, q);
                    links.forEach(l => {
                        let sourceName = `${l.name} [${l.quality || q}]`;
                        if (l.info) sourceName += ` - ${l.info}`;
                        results.push(new StreamResult({
                            url: l.url,
                            source: sourceName,
                            headers: CommonHeaders
                        }));
                    });
                } else {
                    results.push(new StreamResult({
                        url: u,
                        source: q.includes("p") || q === "4K" ? q : `${q} Source`,
                        headers: CommonHeaders
                    }));
                }
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Failed to parse streams: " + e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
