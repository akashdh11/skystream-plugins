(function() {
    const BASE_URL = "https://net22.cc";
    const PLAY_URL = "https://net52.cc";
    const OTT = "nf";

    const CommonHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
            const res = await http_get(`${BASE_URL}/home`, { ...CommonHeaders, "Referer": `${BASE_URL}/`, "Cookie": cookieStr });
            const html = res.body;
            const sections = {};
            
            // Simulating DOM parsing with robust Regex
            const rowRegex = /<div[^>]*class="[^"]*lolomoRow[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*lolomoRow[^"]*"[^>]*>|$)/g;
            let rowMatch;
            while ((rowMatch = rowRegex.exec(html)) !== null) {
                const rowHtml = rowMatch[1];
                
                // Extract Title: Look for row-header-title or rowHeader text
                let title = "Trending";
                const titleMatch = rowHtml.match(/<div class="row-header-title">([\s\S]*?)<\/div>/) || 
                             rowHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
                if (titleMatch) {
                    title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
                }
                
                const items = [];
                // Extract Items: Look for data-src in lazy images
                const imgRegex = /<img[^>]*class="[^"]*lazy[^"]*"[^>]*data-src="([^"]+)"/g;
                let imgMatch;
                while ((imgMatch = imgRegex.exec(rowHtml)) !== null) {
                    const imgSrc = imgMatch[1];
                    const id = imgSrc.split("/").pop().split(".")[0];
                    if (id && !items.some(it => it.url && JSON.parse(it.url).id === id)) {
                        items.push(new MultimediaItem({ playbackPolicy: "Internal Player Only",
                            title: " ", url: JSON.stringify({ id: id }),
                            posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`), type: "movie"
                        }));
                    }
                }
                if (items.length > 0) sections[title] = items;
            }
            cb({ success: true, data: sections });
        } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: e.message }); }
    }

    async function search(query, cb) {
        try {
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/tv/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const results = (data.searchResult || []).map(item => new MultimediaItem({ playbackPolicy: "Internal Player Only",
                title: item.t, url: JSON.stringify({ id: item.id }),
                posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${item.id}.jpg`), type: "movie"
            }));
            cb({ success: true, data: results });
        } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message }); }
    }

    async function load(urlData, cb) {
        try {
            const { id } = JSON.parse(urlData);
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/post.php?id=${id}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/tv/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const episodes = [];
            if (data.episodes && data.episodes.length > 0 && data.episodes[0]) {
                data.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                        url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/epimg/150/${ep.id}.jpg`)
                    }));
                });
                if (data.nextPageShow === 1 && data.nextPageSeason) await fetchEpisodes(id, data.nextPageSeason, 2, episodes, cookieStr);
                if (data.season && data.season.length > 1) {
                    for (let i = 0; i < data.season.length - 1; i++) await fetchEpisodes(id, data.season[i].id, 1, episodes, cookieStr);
                }
            } else {
                episodes.push(new Episode({ name: data.title, season: 1, episode: 1, url: JSON.stringify({ id: id, title: data.title }), posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`) }));
            }
            cb({ success: true, data: new MultimediaItem({ playbackPolicy: "Internal Player Only",
                title: data.title, url: urlData, posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`), description: data.desc,
                type: episodes.length > 1 ? "tvseries" : "movie", year: parseInt(data.year) || undefined, episodes: episodes
            })});
        } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: e.message }); }
    }

    async function fetchEpisodes(seriesId, seasonId, page, episodes, cookieStr) {
        let pg = page;
        while (true) {
            try {
                const url = `${BASE_URL}/episodes.php?s=${seasonId}&series=${seriesId}&t=${Math.floor(Date.now()/1000)}&page=${pg}`;
                const res = await http_get(url, { ...CommonHeaders, "Cookie": cookieStr });
                const data = JSON.parse(res.body);
                if (data.episodes) {
                    data.episodes.forEach(ep => {
                        episodes.push(new Episode({
                            name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                            url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/epimg/150/${ep.id}.jpg`)
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

            const iframeUrl = `${PLAY_URL}/play.php?id=${id}&${h}`;
            const iframeRes = await http_get(iframeUrl, headers2);
            
            const tokenMatch = iframeRes.body.match(/data-h="([^"]+)"/);
            const token = tokenMatch ? tokenMatch[1] : "";
            if (!token) throw new Error("Handshake failed: token not found");

            const playlistHeaders = {
                ...HandshakeHeaders,
                "Referer": `${PLAY_URL}/`,
                "Cookie": cookieStrInitial
            };

            const playlistUrl = `${PLAY_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now()/1000)}&h=${token}`;
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
