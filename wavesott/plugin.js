(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" };

    async function fetchM3U() {
        const res = await http_get(manifest.baseUrl, headers);
        if (res.status >= 200 && res.status < 300) return res.body;
        throw new Error("HTTP Error " + res.status);
    }

    function parseM3uToCarousels(m3u) {
        const cleaned = m3u.replace(/([^\r\n])#EXTINF:/g, "$1\n#EXTINF:");
        const lines = cleaned.split(/\r?\n/), cats = {};
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith('#EXTINF:')) {
                const tMatch = line.match(/#EXTINF:.*?,(.*)/), gMatch = line.match(/group-title="([^"]*)"/), lMatch = line.match(/tvg-logo="([^"]+)"/);
                cur = { title: tMatch ? tMatch[1].trim() : "Unknown", group: (gMatch && gMatch[1].trim()) || "Uncategorized", poster: lMatch ? lMatch[1] : "" };
            } else if (line.startsWith('http') && cur) {
                let u = line, h = Object.assign({}, headers);
                if (u.includes('|')) {
                    const p = u.split('|'); u = p[0];
                    p[1].split('&').forEach(kv => { const eq = kv.indexOf('='); if (eq !== -1) h[kv.substring(0, eq)] = kv.substring(eq + 1); });
                }
                
                if (!cats[cur.group]) cats[cur.group] = [];
                cats[cur.group].push(new MultimediaItem({ 
                    title: cur.title, 
                    url: JSON.stringify({ title: cur.title, url: u, poster: cur.poster, group: cur.group, headers: h }), 
                    posterUrl: cur.poster, 
                    description: "Live TV Channel",
                    type: "livestream"
                }));
                cur = null;
            }
        }
        return cats;
    }

    async function getHome(cb) {
        try {
            const m3u = await fetchM3U();
            cb({ success: true, data: parseM3uToCarousels(m3u) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const m3u = await fetchM3U();
            const cats = parseM3uToCarousels(m3u);
            const results = [];
            const q = query.toLowerCase();

            for (let g in cats) {
                cats[g].forEach(item => {
                    if (item.title.toLowerCase().includes(q)) results.push(item);
                });
            }
            cb({ success: true, data: results });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    async function load(urlStr, cb) {
        try {
            const d = JSON.parse(urlStr);
            cb({
                success: true,
                data: new MultimediaItem({
                    title: d.title,
                    url: urlStr,
                    posterUrl: d.poster,
                    description: d.group,
                    type: "livestream",
                    episodes: [new Episode({
                        name: "Watch Live",
                        season: 1,
                        episode: 1,
                        url: urlStr,
                        posterUrl: d.poster
                    })]
                })
            });
        } catch {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    async function loadStreams(urlStr, cb) {
        try {
            const d = JSON.parse(urlStr);
            cb({
                success: true,
                data: [new StreamResult({
                    url: d.url,
                    quality: "Auto",
                    headers: d.headers || {}
                })]
            });
        } catch {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
