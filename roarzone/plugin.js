(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" };

    async function fetchAndDecryptM3U() {
        const response = await http_get(manifest.baseUrl, headers);
        if (response.status < 200 || response.status >= 300 || !response.body) throw new Error("Network Error " + response.status);
        let s = response.body.trim();
        if (s.length > 79 && !s.startsWith("#EXTM3U")) {
            const part1 = s.substring(0, 10), part2 = s.substring(34, s.length - 54), part3 = s.substring(s.length - 10);
            const data = part1 + part2 + part3, iv = s.substring(10, 34), key = s.substring(s.length - 54, s.length - 10);
            const dec = await sendMessage('crypto_decrypt_aes', JSON.stringify({ data, key, iv }));
            if (dec && dec.includes("#EXTM3U")) return dec;
        }
        return s;
    }

    function parseM3uToCarousels(m3u) {
        const cleaned = m3u.replace(/([^\r\n])#EXTINF:/g, "$1\n#EXTINF:");
        const lines = cleaned.split(/\r?\n/), cats = {};
        let cur = null, pend = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith("#EXTINF:-1")) {
                cur = { title: "Unknown", poster: "", group: "Other Channels", headers: {}, kodiProps: Object.assign({}, pend) };
                const logo = line.match(/tvg-logo="([^"]*)"/); if (logo) cur.poster = logo[1];
                const group = line.match(/group-title="([^"]*)"/); if (group) cur.group = group[1];
                
                const split = line.split(","); 
                if (split.length > 1) cur.title = split[split.length - 1].trim();
                pend = {};
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=") && cur) {
                cur.headers["User-Agent"] = line.split("=")[1].trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) {
                pend.licenseUrl = line.split("=")[1].trim();
            } else if (line.startsWith("http") && cur) {
                if (line.includes("|")) {
                    const parts = line.split("|"); cur.url = parts[0];
                    parts[1].split("&").forEach(kv => { const [k, v] = kv.split("="); if (k && v) cur.headers[k] = v; });
                } else cur.url = line;

                if (!cats[cur.group]) cats[cur.group] = [];
                cats[cur.group].push(new MultimediaItem({ 
                    title: cur.title, 
                    url: JSON.stringify(cur), 
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
            const m3u = await fetchAndDecryptM3U();
            if (!m3u || !m3u.startsWith("#EXTM3U")) throw new Error("Invalid M3U");
            cb({ success: true, data: parseM3uToCarousels(m3u) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const m3u = await fetchAndDecryptM3U();
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
            const stream = new StreamResult({
                url: d.url,
                source: "Auto",
                headers: d.headers || {}
            });

            if (d.kodiProps?.licenseUrl && d.url.includes(".mpd")) {
                const res = await http_get(d.url, d.headers || {});
                const kidMatch = res.body.match(/cenc:default_KID=["']([^"']+)["']/i);
                if (kidMatch) {
                    const kid = kidMatch[1].replace(/-/g, "").toLowerCase();
                    const b = []; for (let i = 0; i < kid.length; i += 2) b.push(parseInt(kid.substr(i, 2), 16));
                    const kidB64 = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
                    
                    const lRes = await http_post(d.kodiProps.licenseUrl, { 
                        "User-Agent": "Dalvik/2.1.0", 
                        "Content-Type": "application/json" 
                    }, JSON.stringify({ "kids": [kidB64], "type": "temporary" }));
                    
                    const lData = JSON.parse(lRes.body);
                    if (lData.keys?.length > 0) {
                        stream.drmKey = lData.keys[0].k;
                        stream.drmKid = kidB64;
                        stream.licenseUrl = d.kodiProps.licenseUrl;
                    }
                }
            }
            cb({ success: true, data: [stream] });
        } catch {
            cb({ success: true, data: [new StreamResult({ url: JSON.parse(urlStr).url, source: "Auto" })] });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
