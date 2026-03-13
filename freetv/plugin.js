(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const M3U_URL = "https://playlist-storage.pages.dev/PLAYLIST/freetv.m3u";
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    };

    /**
     * Helper to fetch and decrypt the M3U playlist.
     */
    async function fetchAndDecryptM3U() {
        const res = await http_get(M3U_URL, HEADERS);
        const status = res.status !== undefined ? res.status : res.statusCode;
        if (status < 200 || status >= 300) throw new Error("HTTP Error " + status);
        
        const body = res.body.trim();
        if (!body) throw new Error("Empty body");

        // Legacy decryption logic
        if (body.length > 79 && !body.startsWith("#EXTM3U")) {
            const finalData = body.substring(0, 10) + body.substring(34, body.length - 54) + body.substring(body.length - 10);
            const iv = body.substring(10, 34);
            const key = body.substring(body.length - 54, body.length - 10);
            
            // Note: sendMessage('crypto_decrypt_aes', ...) is a platform call
            const decrypted = await sendMessage('crypto_decrypt_aes', JSON.stringify({ data: finalData, key, iv }));
            if (decrypted && decrypted.includes("#EXTM3U")) return decrypted;
            throw new Error("Decryption failed");
        }
        return body;
    }

    /**
     * Helper to parse M3U content.
     */
    function parseM3U(m3uContent) {
        const lines = m3uContent.split('\n');
        const categories = {};
        let current = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('#EXTINF:')) {
                const titleMatch = line.match(/#EXTINF:-1.*?,(.*)/);
                const groupMatch = line.match(/group-title="([^"]+)"/);
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                current = {
                    title: titleMatch ? titleMatch[1].trim() : "Unknown",
                    group: groupMatch ? groupMatch[1] : "Uncategorized",
                    poster: logoMatch ? logoMatch[1] : ""
                };
            } else if (line.startsWith('http') && current) {
                let url = line, h = Object.assign({}, HEADERS);
                if (line.includes('|')) {
                    const parts = line.split('|');
                    url = parts[0];
                    parts[1].split('&').forEach(kv => {
                        const s = kv.split('=');
                        if (s.length === 2) h[s[0]] = s[1];
                    });
                }
                
                const item = new MultimediaItem({
                    title: current.title,
                    url: JSON.stringify({ title: current.title, poster: current.poster, url, headers: h }),
                    posterUrl: current.poster,
                    type: "livestream",
                    description: "Live TV Channel"
                });

                if (!current.poster || current.poster.includes("placehold.co")) {
                    item.posterUrl = `https://placehold.co/400x600.png?text=${encodeURIComponent(current.title)}`;
                }

                if (!categories[current.group]) categories[current.group] = [];
                categories[current.group].push(item);
                current = null;
            }
        }
        return categories;
    }

    async function getHome(cb) {
        try {
            const m3u = await fetchAndDecryptM3U();
            cb({ success: true, data: parseM3U(m3u) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const m3u = await fetchAndDecryptM3U();
            const cars = parseM3U(m3u);
            const out = [];
            const low = query.toLowerCase();
            for (let g in cars) {
                cars[g].forEach(i => { if (i.title.toLowerCase().includes(low)) out.push(i); });
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: true, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            let data;
            try { data = JSON.parse(url); } catch { data = { url }; }
            const poster = data.poster || `https://placehold.co/400x600.png?text=${encodeURIComponent(data.title)}`;
            cb({
                success: true,
                data: new MultimediaItem({
                    title: data.title || "Live Stream",
                    url: url,
                    posterUrl: poster,
                    type: "livestream",
                    description: "Live TV Channel",
                    episodes: [new Episode({ name: "Watch Live", season: 1, episode: 1, url: url, posterUrl: poster })]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(urlInfo, cb) {
        try {
            const channel = JSON.parse(urlInfo);
            cb({
                success: true,
                data: [new StreamResult({
                    url: channel.url,
                    quality: "Auto",
                    headers: channel.headers || {}
                })]
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // Export to global scope
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
