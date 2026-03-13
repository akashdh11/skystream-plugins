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
        let lines = m3u.split('\n'), cats = {}, cur = null;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.startsWith("#EXTINF:-1")) {
                cur = { title: "Unknown", poster: "", group: "Other Channels", headers: {}, kodiProps: {} };
                const logo = line.match(/tvg-logo="([^"]*)"/); if (logo) cur.poster = logo[1];
                const group = line.match(/group-title="([^"]*)"/); if (group) { cur.group = group[1]; if (!cats[cur.group]) cats[cur.group] = []; }
                const split = line.split(","); if (split.length > 1) cur.title = split[split.length - 1].trim();
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=") && cur) {
                cur.headers["User-Agent"] = line.split("=")[1].trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=") && cur) {
                cur.kodiProps.licenseUrl = line.split("=")[1].trim();
            } else if (line.startsWith("http") && cur) {
                cur.url = line;
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
            const m3u = await fetchM3U();
            if (!m3u || !m3u.startsWith("#EXTM3U")) throw new Error("Invalid M3U");
            cb({ success: true, data: parseM3uToCarousels(m3u) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const m3u = await fetchM3U();
            const cats = parseM3uToCarousels(m3u);
            const out = [], q = query.toLowerCase();
            for (let g in cats) cats[g].forEach(i => { if (i.title.toLowerCase().includes(q)) out.push(i); });
            cb({ success: true, data: out });
        } catch { cb({ success: true, data: [] }); }
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
            const d = JSON.parse(urlInfo);
            const stream = new StreamResult({ 
                url: d.url, 
                quality: "Auto", 
                headers: d.headers || {} 
            });

            if (d.kodiProps?.licenseUrl && d.url.includes(".mpd")) {
                const res = await http_get(d.url, d.headers || {});
                const kidMatch = res.body.match(/cenc:default_KID=["']([^"']+)["']/i);
                if (kidMatch) {
                    const kid = kidMatch[1].replace(/-/g, "").toLowerCase();
                    let b = []; for (let i = 0; i < kid.length; i += 2) b.push(parseInt(kid.substr(i, 2), 16));
                    const kidB64 = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
                    const lRes = await http_post(d.kodiProps.licenseUrl, { "User-Agent": "Dalvik/2.1.0", "Content-Type": "application/json" }, JSON.stringify({ "kids": [kidB64], "type": "temporary" }));
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
            cb({ success: true, data: [new StreamResult({ url: JSON.parse(urlInfo).url, quality: "Auto" })] }); 
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
