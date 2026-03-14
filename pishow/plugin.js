(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36" };

    async function fetchAndDecryptM3U() {
        const res = await http_get(manifest.baseUrl, headers);
        if (!res || res.status < 200 || res.status >= 300 || !res.body) throw new Error("Network Error " + (res ? res.status : "null"));
        let s = res.body.trim();
        if (s.length > 79 && !s.startsWith("#EXTM3U")) {
            const part1 = s.substring(0, 10), part2 = s.substring(34, s.length - 54), part3 = s.substring(s.length - 10);
            const data = part1 + part2 + part3, iv = s.substring(10, 34), key = s.substring(s.length - 54, s.length - 10);
            return await crypto.decryptAES(data, key, iv);
        }
        return s;
    }

    function parseM3uToCarousels(m3u) {
        const cleaned = m3u.replace(/([^\r\n])#EXTINF:/g, "$1\n#EXTINF:");
        const lines = cleaned.split(/\r?\n/), cats = {};
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith('#EXTINF:')) {
                const tMatch = line.match(/#EXTINF:.*?,(.*)/);
                const gMatch = line.match(/group-title="([^"]*)"/);
                const lMatch = line.match(/tvg-logo="([^"]+)"/);
                cur = { 
                    title: tMatch ? tMatch[1].trim() : "Unknown", 
                    group: (gMatch && gMatch[1].trim()) || "Uncategorized", 
                    poster: lMatch ? lMatch[1] : "" 
                };
            } else if (line.startsWith('http') && cur) {
                let u = line, h = Object.assign({}, headers);
                if (u.includes('|')) {
                    const p = u.split('|'); 
                    u = p[0];
                    p[1].split('&').forEach(kv => { 
                        const s = kv.split('='); 
                        if (s.length === 2) h[s[0]] = s[1]; 
                    });
                }
                if (!cats[cur.group]) cats[cur.group] = [];
                cats[cur.group].push(new MultimediaItem({ 
                    title: cur.title, 
                    url: JSON.stringify({ title: cur.title, url: u, poster: cur.poster, group: cur.group, headers: h }), 
                    posterUrl: cur.poster, 
                    type: "livestream",
                    description: "Live TV Channel"
                }));
                cur = null;
            }
        }
        return cats;
    }

    async function getHome(cb) {
        try {
            const m3u = await fetchAndDecryptM3U();
            if (!m3u || m3u.includes("Failed")) throw new Error("Decryption failed");
            cb({ success: true, data: parseM3uToCarousels(m3u) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const m3u = await fetchAndDecryptM3U();
            if (!m3u) return cb({ success: true, data: [] });
            
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
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid channel data" });
        }
    }

    async function loadStreams(urlStr, cb) {
        try {
            const d = JSON.parse(urlStr);
            cb({
                success: true,
                data: [new StreamResult({
                    url: d.url,
                    source: "Auto",
                    headers: d.headers || {}
                })]
            });
        } catch {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Failed to load stream" });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
