(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const MATCH_CARD_API = "https://live-card-png.cricify.workers.dev/";
    const KEYS = [
        { key: "M2hIenhZQWdTR0k4L2hhbQ==", iv: "VXFDdmt2amVjRUl6ODQyVg==" },
        { key: "TXFlWUdDVDRBWUtvSEtyVA==", iv: "b0hLclRRdVB4OHpsOG9KKw==" }
    ];

    async function fetchAndDecrypt(url) {
        const res = await http_get(url, { 
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 10; SM-A505F)",
            "Host": "cfyjgfbnjjgv103.top" 
        });
        if (!res || !res.body) return null;
        let body = res.body.trim();
        if (body.startsWith("{") || body.startsWith("[")) return JSON.parse(body);
        
        const cleanB64 = body.replace(/\s/g, "");
        for (const k of KEYS) {
            try {
                const dec = await sendMessage('crypto_decrypt_aes', JSON.stringify({ data: cleanB64, key: k.key, iv: k.iv }));
                if (dec && typeof dec === 'string' && (dec.trim().startsWith("{") || dec.trim().startsWith("["))) {
                    return JSON.parse(dec.trim());
                }
            } catch (e) {
                console.error("Decryption attempt failed for key: " + k.key.substring(0, 5));
            }
        }
        return null;
    }

    function getStatus(info) {
        const now = Date.now();
        const stStr = info?.startTime ? info.startTime.replace(" +0000", "Z").replace(/\//g, "-") : null;
        const etStr = info?.endTime ? info.endTime.replace(" +0000", "Z").replace(/\//g, "-") : null;
        const st = stStr ? new Date(stStr).getTime() : null;
        const et = etStr ? new Date(etStr).getTime() : null;
        
        if (et && now >= et) return "✅";
        if (st && now >= st) return "🔴";
        if (st && now < st) return "🔜";
        return "🔴";
    }

    function generateCard(e) {
        const i = e.eventInfo, t = encodeURIComponent(i?.eventName || e.title || "");
        let u = `${MATCH_CARD_API}?title=${t}&teamA=${encodeURIComponent(i?.teamA || "A")}&teamB=${encodeURIComponent(i?.teamB || "B")}`;
        if (i?.teamAFlag) u += "&teamAImg=" + encodeURIComponent(i.teamAFlag);
        if (i?.teamBFlag) u += "&teamBImg=" + encodeURIComponent(i.teamBFlag);
        if (i?.startTime) u += "&time=" + encodeURIComponent(i.startTime);
        return u;
    }

    async function getHome(cb) {
        try {
            const events = await fetchAndDecrypt(`${manifest.baseUrl}/categories/live-events.txt`);
            if (!events) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load events" });
            
            const categories = {};
            events.forEach(e => {
                const rawCat = e.eventInfo?.eventCat || e.cat || "Other";
                const icon = /cricket/i.test(rawCat) ? "🏏" : /football/i.test(rawCat) ? "⚽" : "📺";
                const cat = `${icon} ${rawCat}`;
                if (!categories[cat]) categories[cat] = [];
                
                const displayTitle = (e.eventInfo?.teamA && e.eventInfo?.teamB && e.eventInfo.teamA !== e.eventInfo.teamB) 
                    ? `${e.eventInfo.teamA} vs ${e.eventInfo.teamB}` 
                    : (e.title || e.eventInfo?.teamA);
                
                const fullTitle = `${getStatus(e.eventInfo)} ${displayTitle}`;
                const poster = generateCard(e);
                
                categories[cat].push(new MultimediaItem({
                    title: fullTitle,
                    url: JSON.stringify({ slug: e.slug, title: displayTitle, poster, eventInfo: e.eventInfo }),
                    posterUrl: poster,
                    type: "livestream",
                    description: e.eventInfo?.eventName || "Live Event"
                }));
            });
            cb({ success: true, data: categories });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const events = await fetchAndDecrypt(`${manifest.baseUrl}/categories/live-events.txt`);
            if (!events) return cb({ success: true, data: [] });
            
            const q = query.toLowerCase();
            const results = [];
            events.forEach(e => {
                const txt = `${e.title} ${e.eventInfo?.teamA} ${e.eventInfo?.teamB} ${e.eventInfo?.eventName}`.toLowerCase();
                if (txt.includes(q)) {
                    const poster = generateCard(e);
                    results.push(new MultimediaItem({
                        title: `${getStatus(e.eventInfo)} ${e.title || "Event"}`,
                        url: JSON.stringify({ slug: e.slug, title: e.title, poster, eventInfo: e.eventInfo }),
                        posterUrl: poster,
                        type: "livestream"
                    }));
                }
            });
            cb({ success: true, data: results });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    async function load(urlStr, cb) {
        try {
            const data = JSON.parse(urlStr);
            const plot = `🏆 ${data.eventInfo?.eventName || ""}\n🕐 ${data.eventInfo?.startTime || ""}`;
            cb({
                success: true,
                data: new MultimediaItem({
                    title: data.title,
                    url: urlStr,
                    posterUrl: data.poster,
                    description: plot,
                    type: "livestream",
                    episodes: [new Episode({
                        name: "Watch Live",
                        season: 1,
                        episode: 1,
                        url: urlStr,
                        posterUrl: data.poster
                    })]
                })
            });
        } catch {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid event data" });
        }
    }

    async function loadStreams(urlStr, cb) {
        try {
            const data = JSON.parse(urlStr);
            const channelsUrl = `${manifest.baseUrl}/channels/${data.slug.toLowerCase()}.txt`;
            const list = await fetchAndDecrypt(channelsUrl);
            const results = [];
            
            if (list && list.streamUrls) {
                list.streamUrls.forEach((s, idx) => {
                    let u = s.link;
                    let h = {};
                    if (u && u.includes("|")) {
                        const parts = u.split("|");
                        u = parts[0];
                        parts[1].split("&").forEach(kv => {
                            const [k, v] = kv.split("=");
                            if (k && v) h[k] = v;
                        });
                    }
                    
                    const res = new StreamResult({
                        quality: s.title || `Server ${idx + 1}`,
                        url: u,
                        headers: h
                    });
                    
                    if (s.type === "7" && s.api && s.api.includes(":")) {
                        const [kid, key] = s.api.split(":");
                        // Legacy uses a complex b64/atob/hex conversion, simplified assuming raw hex for clearkey
                        // But we'll try to follow legacy logic if possible.
                        // For ClearKey in Dash, we usually just need the Kid and Key in b64
                        res.drmKid = btoa(kid).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                        res.drmKey = btoa(key).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                        res.drmType = "clearkey";
                    }
                    results.push(res);
                });
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "Failed to load streams: " + e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
