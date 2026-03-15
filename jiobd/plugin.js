(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const CommonHeaders = { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android)" };

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

            // [CRITICAL] play.php requires a session cookie (X_CACHE_KEY) for HLS reloads.
            // We hit the URL once to capture the Set-Cookie header.
            let playUrl = d.url;
            if (d.url.includes("play.php")) {
                try {
                    const res = await http_get(d.url, headers);
                    console.log("[JioBD] play.php response code: " + res.status);
                    if (res && res.headers) {
                        console.log("[JioBD] Response Headers: " + JSON.stringify(res.headers));
                        // Capture all cookies from either 'set-cookie' or 'cookie' header
                        const cookieHeader = res.headers["set-cookie"] || res.headers["Set-Cookie"] || res.headers["cookie"] || res.headers["Cookie"];
                        if (cookieHeader) {
                            // If it's the result of our js_engine alias, it might already be semicolon separated.
                            // We want the most complete cookie string possible for the player.
                            console.log("[JioBD] Captured Cookies: " + cookieHeader);
                            headers["Cookie"] = cookieHeader;
                        }
                    }
                    if (res && res.finalUrl && res.finalUrl !== d.url) {
                        console.log("[JioBD] Redirected to: " + res.finalUrl);
                        playUrl = res.finalUrl;
                    }
                } catch (e) {
                    console.error("[JioBD] Cookie fetch error: " + e.message);
                }
            }

            if (d.kodiProps?.licenseUrl && playUrl.includes(".mpd")) {
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
                            "User-Agent": "Dalvik/2.1.0", 
                            "Content-Type": "application/json" 
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
            cb({ success: true, data: [new StreamResult({ url: playUrl, source: "Auto", headers: headers })] });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
