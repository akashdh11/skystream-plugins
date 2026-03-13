(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" };

    async function fetchM3U() {
        const res = await http_get(manifest.baseUrl, headers);
        if (res.status >= 200 && res.status < 300) return res.body;
        throw new Error("HTTP Error " + res.status);
    }

    function parseM3uToCarousels(m3u) {
        const cleaned = m3u.replace(/([^\r\n])#EXTINF:/g, "$1\n#EXTINF:");
        const lines = cleaned.split(/\r?\n/), cats = {};
        let pend = {}, cur = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) {
                pend.licenseUrl = line.split("=")[1].trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_type=")) {
                pend.licenseType = line.split("=")[1].trim();
            } else if (line.startsWith('#EXTINF:')) {
                const tMatch = line.match(/#EXTINF:.*?,(.*)/), gMatch = line.match(/group-title="([^"]*)"/), lMatch = line.match(/tvg-logo="([^"]+)"/);
                cur = { 
                    title: tMatch ? tMatch[1].trim() : "Unknown", 
                    group: (gMatch && gMatch[1].trim()) || "Uncategorized", 
                    poster: lMatch ? lMatch[1] : "", 
                    kodiProps: Object.assign({}, pend) 
                };
                pend = {};
            } else if (line.startsWith('http') && cur) {
                if (!cats[cur.group]) cats[cur.group] = [];
                cats[cur.group].push(new MultimediaItem({ 
                    title: cur.title, 
                    url: JSON.stringify({ title: cur.title, url: line, poster: cur.poster, group: cur.group, headers: headers, kodiProps: cur.kodiProps }), 
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

    async function loadStreams(urlInfo, cb) {
        try {
            const c = JSON.parse(urlInfo);
            const stream = new StreamResult({ 
                url: c.url, 
                quality: "Auto", 
                headers: c.headers || {} 
            });

            if (c.kodiProps?.licenseUrl) {
                const parts = c.kodiProps.licenseUrl.split(":");
                if (parts.length === 2 && !c.kodiProps.licenseUrl.includes("http")) {
                    stream.drmKid = parts[0]; 
                    stream.drmKey = parts[1];
                } else {
                    stream.licenseUrl = c.kodiProps.licenseUrl;
                }
            }
            cb({ success: true, data: [stream] });
        } catch {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Failed to parse stream info" });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
