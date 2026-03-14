(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const CommonHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:78.0) Gecko/20100101 Firefox/78.0",
    "Accept": "*/*",
    "Cache-Control": "no-cache, no-store"
};

    function parseM3U(m3u) {
        const lines = m3u.split('\n');
        const items = [];
        let cur = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("#EXTINF:-1")) {
                cur = { title: "Unknown", poster: "", group: "Other Channels", headers: { ...CommonHeaders }, kodiProps: {} };
                const logo = line.match(/tvg-logo="([^"]*)"/); if (logo) cur.poster = logo[1];
                const group = line.match(/group-title="([^"]*)"/); if (group) cur.group = group[1];
                const split = line.split(","); if (split.length > 1) cur.title = split[split.length - 1].trim();
            } else if (line.startsWith("#EXTHTTP:") && cur) {
                try {
                    const json = line.substring(9).trim();
                    const httpData = JSON.parse(json);
                    if (httpData.cookie) cur.headers["Cookie"] = httpData.cookie;
                    if (httpData["user-agent"]) cur.headers["User-Agent"] = httpData["user-agent"];
                } catch (e) {}
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=") && cur) {
                cur.headers["User-Agent"] = line.split("=")[1].trim();
            } else if (line.startsWith("#EXTVLCOPT:http-referrer=") && cur) {
                cur.headers["Referer"] = line.split("=")[1].trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=") && cur) {
                cur.kodiProps.licenseUrl = line.split("=")[1].trim();
            } else if (line.startsWith("http") && cur) {
                cur.url = line;
                items.push(new MultimediaItem({
                    title: cur.title,
                    url: JSON.stringify(cur),
                    posterUrl: cur.poster,
                    type: "livestream",
                    description: cur.group
                }));
                cur = null;
            }
        }
        return items;
    }

    async function getHome(cb) {
        try {
            const res = await http_get(`${manifest.baseUrl}/JIOBDNEW.php`, CommonHeaders);
            if (!res || !res.body || !res.body.startsWith("#EXTM3U")) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Invalid M3U" });
            }
            const allItems = parseM3U(res.body);
            const categories = {};
            allItems.forEach(item => {
                const cat = item.description || "Other Channels";
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(item);
            });
            cb({ success: true, data: categories });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(`${manifest.baseUrl}/JIOBDNEW.php`, CommonHeaders);
            if (!res || !res.body) return cb({ success: true, data: [] });
            const allItems = parseM3U(res.body);
            const q = query.toLowerCase();
            const filtered = allItems.filter(i => i.title.toLowerCase().includes(q));
            cb({ success: true, data: filtered });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            let d;
            try { d = JSON.parse(url); } catch { d = { title: "Live TV", url: url, poster: "" }; }
            
            cb({
                success: true,
                data: new MultimediaItem({
                    title: d.title,
                    url: url,
                    posterUrl: d.poster,
                    type: "livestream",
                    description: d.group || "Live TV Channel",
                    episodes: [new Episode({
                        name: "Watch Live",
                        season: 1,
                        episode: 1,
                        url: url,
                        posterUrl: d.poster
                    })]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            let d;
            try { d = JSON.parse(dataStr); } catch { d = { url: dataStr, headers: { ...CommonHeaders } }; }
            
            // Ensure headers have essential keys
            const headers = { ...CommonHeaders, ...(d.headers || {}) };

            if (d.kodiProps?.licenseUrl && d.url.includes(".mpd")) {
                const res = await http_get(d.url, headers);
                if (res && res.body) {
                    const kidMatch = res.body.match(/cenc:default_KID=["']([^"']+)["']/i);
                    if (kidMatch) {
                        const kid = kidMatch[1].replace(/-/g, "").toLowerCase();
                        let b = [];
                        for (let i = 0; i < kid.length; i += 2) b.push(parseInt(kid.substr(i, 2), 16));
                        const kidB64 = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
                        
                        const body = JSON.stringify({ "kids": [kidB64], "type": "temporary" });
                        const lRes = await http_post(d.kodiProps.licenseUrl, { 
                            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android)", 
                            "Content-Type": "application/json;charset=UTF-8" 
                        }, body);
                        
                        if (lRes && lRes.body) {
                            try {
                                const lData = JSON.parse(lRes.body);
                                if (lData.keys && lData.keys.length > 0) {
                                    return cb({
                                        success: true,
                                        data: [new StreamResult({
                                            url: d.url,
                                            source: "Auto",
                                            headers: headers,
                                            drmKey: lData.keys[0].k,
                                            drmKid: kidB64,
                                            licenseUrl: d.kodiProps.licenseUrl
                                        })]
                                    });
                                }
                            } catch (e) {
                                console.error("License parse error: " + e.message);
                            }
                        }
                    }
                }
            }
            cb({ success: true, data: [new StreamResult({ url: d.url, source: "Auto", headers: headers })] });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
