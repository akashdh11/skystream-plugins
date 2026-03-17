(function() {
    const BASE_URL = "https://net22.cc";
    const PLAY_URL = "https://net52.cc";
    const OTT = "hs";

    const CommonHeaders = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "sec-ch-ua": "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Android WebView\";v=\"144\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Android\"",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0",
        "X-Requested-With": "XMLHttpRequest"
    };

    let cachedCookie = "";
    let lastBypassTime = 0;

    async function bypass() {
        if (cachedCookie && Date.now() - lastBypassTime < 30 * 60 * 1000) return cachedCookie;
        for (let i = 0; i < 5; i++) {
            try {
                const res = await http_post(`${PLAY_URL}/tv/p.php`, { ...CommonHeaders, "X-Requested-With": "XMLHttpRequest" }, "");
                if (res.body && res.body.includes('"r":"n"')) {
                    let setCookie = res.headers['set-cookie'] || res.headers['Set-Cookie'] || "";
                    if (Array.isArray(setCookie)) setCookie = setCookie.join("; ");
                    const match = setCookie.match(/t_hash_t=([^;]+)/);
                    if (match) {
                        cachedCookie = decodeURIComponent(match[1]);
                        lastBypassTime = Date.now();
                        return cachedCookie;
                    }
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error("Failed to bypass authentication");
    }

    async function getCookieString() {
        const hash = await bypass();
        return `t_hash_t=${hash}; ott=${OTT}; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`;
    }

    function proxyImage(url) {
        if (!url) return "";
        return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=500`;
    }

    async function getHome(cb) {
        try {
            const cookieStr = await getCookieString();
            const res = await http_get(`${PLAY_URL}/mobile/home?app=1`, { 
                ...CommonHeaders, 
                "Referer": `${PLAY_URL}/mobile/home?app=1`, 
                "Cookie": cookieStr,
            });
            const html = res.body;
            const sections = {};
            
            // Stateful parsing: scan whole page for titles and items in order
            const globalRegex = /<(h2|span|div|p)[^>]*class="[^"]*(tray-title|mobile-tray-title|title|tray-title-container)[^"]*"[^>]*>([\s\S]*?)<\/\1>|data-post="([^"]+)"/ig;
            
            let currentTitle = "Trending";
            let gMatch;
            while ((gMatch = globalRegex.exec(html)) !== null) {
                if (gMatch[3]) { // Title match
                    const titleText = gMatch[3].replace(/<[^>]*>/g, "").trim();
                    // Basic sanity check for category names
                    if (titleText && titleText.length > 2 && titleText.length < 50 && !titleText.includes("{")) {
                        currentTitle = titleText;
                    }
                } else if (gMatch[4]) { // Item ID match
                    const id = gMatch[4];
                    // Filter out non-functional template IDs
                    if (id && !id.includes("'") && !id.includes("+")) {
                        if (!sections[currentTitle]) sections[currentTitle] = [];
                        if (!sections[currentTitle].some(it => JSON.parse(it.url).id === id)) {
                            sections[currentTitle].push(new MultimediaItem({ playbackPolicy: "Internal Player Only",
                                title: " ", url: JSON.stringify({ id: id }),
                                posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${id}.jpg`), type: "movie"
                            }));
                        }
                    }
                }
            }

            cb({ success: true, data: sections });
        } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: e.message }); }
    }

    async function search(query, cb) {
        try {
            const cookieStr = await getCookieString();
            const url = `${PLAY_URL}/mobile/hs/search.php?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const results = (data.searchResult || []).map(item => new MultimediaItem({ playbackPolicy: "Internal Player Only",
                title: item.t, url: JSON.stringify({ id: item.id }),
                posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${item.id}.jpg`), type: "movie"
            }));
            cb({ success: true, data: results });
        } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message }); }
    }

    async function load(urlData, cb) {
        try {
            const { id } = JSON.parse(urlData);
            const cookieStr = await getCookieString();
            const url = `${PLAY_URL}/mobile/hs/post.php?id=${id}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/tv/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const episodes = [];
            if (data.episodes && data.episodes.length > 0 && data.episodes[0]) {
                data.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                        url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/hsepimg/150/${ep.id}.jpg`)
                    }));
                });
                if (data.nextPageShow === 1 && data.nextPageSeason) await fetchEpisodes(id, data.nextPageSeason, 2, episodes, cookieStr);
                if (data.season && data.season.length > 1) {
                    for (let i = 0; i < data.season.length - 1; i++) await fetchEpisodes(id, data.season[i].id, 1, episodes, cookieStr);
                }
            } else {
                episodes.push(new Episode({ name: data.title, season: 1, episode: 1, url: JSON.stringify({ id: id, title: data.title }), posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${id}.jpg`) }));
            }
            cb({ success: true, data: new MultimediaItem({ playbackPolicy: "Internal Player Only",
                title: data.title, url: urlData, posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${id}.jpg`), description: data.desc,
                type: episodes.length > 1 ? "tvseries" : "movie", year: parseInt(data.year) || undefined, episodes: episodes
            })});
        } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: e.message }); }
    }

    async function fetchEpisodes(seriesId, seasonId, page, episodes, cookieStr) {
        let pg = page;
        while (true) {
            try {
                const url = `${PLAY_URL}/mobile/hs/episodes.php?s=${seasonId}&series=${seriesId}&t=${Math.floor(Date.now()/1000)}&page=${pg}`;
                const res = await http_get(url, { ...CommonHeaders, "Cookie": cookieStr });
                const data = JSON.parse(res.body);
                if (data.episodes) {
                    data.episodes.forEach(ep => {
                        episodes.push(new Episode({
                            name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                            url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/hsepimg/150/${ep.id}.jpg`)
                        }));
                    });
                }
                if (data.nextPageShow === 0) break;
                pg++;
            } catch (e) { break; }
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const { id, title } = JSON.parse(dataStr);
            const globalHash = await bypass();
            const cookieStrInitial = `t_hash_t=${globalHash}; ott=${OTT}; hd=on`;
            const HandshakeHeaders = {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                "Referer": `${BASE_URL}/`,
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/plain, */*",
                "Connection": "keep-alive"
            };

            const playPostRes = await http_post(`${BASE_URL}/play.php`, { 
                ...HandshakeHeaders, "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieStrInitial 
            }, `id=${id}`);
            const { h } = JSON.parse(playPostRes.body);

            const headers2 = {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-GB,en;q=0.9",
                "Connection": "keep-alive",
                "Host": "net52.cc",
                "Referer": `${BASE_URL}/`,
                "sec-ch-ua": "\"Chromium\";v=\"142\", \"Brave\";v=\"142\", \"Not_A Brand\";v=\"99\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Linux\"",
                "Sec-Fetch-Dest": "iframe",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Storage-Access": "none",
                "Sec-Fetch-User": "?1",
                "Sec-GPC": "1",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                "Cookie": cookieStrInitial
            };

            const iframeRes = await http_get(`${PLAY_URL}/play.php?id=${id}&${h}`, headers2);
            const tokenMatch = iframeRes.body.match(/data-h="([^"]+)"/);
            const token = tokenMatch ? tokenMatch[1] : "";
            if (!token) throw new Error("Handshake failed: token not found");

            const playlistHeaders = {
                ...HandshakeHeaders,
                "Referer": `${PLAY_URL}/`,
                "Cookie": cookieStrInitial
            };

            const playlistUrl = `${PLAY_URL}/mobile/hs/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now()/1000)}&h=${token}`;
            const listRes = await http_get(playlistUrl, playlistHeaders);
            const playlist = JSON.parse(listRes.body);
            const results = [];
            playlist.forEach(item => {
                if (item.sources) {
                    item.sources.forEach(src => {
                        let fullUrl = src.file.replace("/tv/", "/");
                        if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                        const finalUrl = PLAY_URL + "/" + fullUrl;

                        const inMatch = src.file.match(/[?&]in=([^&]+)/);
                        const streamHash = inMatch ? decodeURIComponent(inMatch[1]) : globalHash;
                        const streamCookie = `t_hash_t=${streamHash}; ott=${OTT}; hd=on`;

                        const proxifiedUrl = "MAGIC_PROXY_v1" + btoa(finalUrl);
                        results.push(new StreamResult({
                            url: proxifiedUrl, source: `NetMirror [${src.label}]`, type: "hls",
                            headers: { 
                                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", 
                                "Referer": `${PLAY_URL}/`, 
                                "Cookie": streamCookie,
                                "sec-ch-ua": "\"Chromium\";v=\"142\", \"Brave\";v=\"142\", \"Not_A Brand\";v=\"99\"",
                                "sec-ch-ua-mobile": "?0",
                                "sec-ch-ua-platform": "\"Linux\"",
                                "Accept": "*/*",
                                "Accept-Encoding": "identity",
                                "Connection": "keep-alive"
                            }
                        }));
                    });
                }
            });
            cb({ success: true, data: results });
        } catch (e) { cb({ success: false, errorCode: "STREAM_ERROR", message: e.message }); }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
