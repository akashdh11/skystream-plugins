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
        if (cachedCookie && Date.now() - lastBypassTime < 30 * 60 * 1000) {
            return cachedCookie;
        }

        console.log("[NetMirror-Netflix] Bypassing authentication...");
        for (let i = 0; i < 5; i++) {
            try {
                const res = await http_post(`${PLAY_URL}/tv/p.php`, { ...CommonHeaders, "X-Requested-With": "XMLHttpRequest" }, "");
                if (res.body && res.body.includes('"r":"n"')) {
                    let setCookie = res.headers['set-cookie'] || res.headers['Set-Cookie'] || "";
                    if (Array.isArray(setCookie)) setCookie = setCookie.join("; ");
                    
                    const match = setCookie.match(/t_hash_t=([^;]+)/);
                    if (match) {
                        cachedCookie = match[1];
                        lastBypassTime = Date.now();
                        return cachedCookie;
                    }
                }
            } catch (e) {
                console.error("[NetMirror-Netflix] Bypass attempt " + i + " failed: " + e);
            }
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
            const headers = { 
                ...CommonHeaders, 
                "Referer": `${BASE_URL}/`,
                "Cookie": cookieStr
            };
            const res = await http_get(`${BASE_URL}/home`, headers);
            const doc = await parseHtml(res.body);
            const rows = Array.from(doc.querySelectorAll(".lolomoRow"));
            
            const sections = {};

            rows.forEach(row => {
                const title = row.querySelector("h2")?.textContent?.trim() || "Trending";
                const items = Array.from(row.querySelectorAll("img.lazy")).map(img => {
                    const dataSrc = img.getAttribute("data-src") || "";
                    const id = dataSrc.split("/").pop()?.split(".")[0];
                    if (!id) return null;

                    return new MultimediaItem({
                        title: " ",
                        url: JSON.stringify({ id: id }),
                        posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`),
                        type: "movie" // Placeholder, will be refined in load()
                    });
                }).filter(i => i !== null);

                if (items.length > 0) {
                    sections[title] = items;
                }
            });

            cb({ success: true, data: sections });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now()/1000)}`;
            const headers = { 
                ...CommonHeaders, 
                "Referer": `${BASE_URL}/tv/home`,
                "Cookie": cookieStr
            };
            const res = await http_get(url, headers);
            const data = JSON.parse(res.body);
            
            const results = data.searchResult.map(item => new MultimediaItem({
                title: item.t,
                url: JSON.stringify({ id: item.id }),
                posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${item.id}.jpg`),
                type: "movie"
            }));

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(urlData, cb) {
        try {
            const { id } = JSON.parse(urlData);
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/post.php?id=${id}&t=${Math.floor(Date.now()/1000)}`;
            const headers = { 
                ...CommonHeaders, 
                "Referer": `${BASE_URL}/tv/home`,
                "Cookie": cookieStr
            };
            const res = await http_get(url, headers);
            const data = JSON.parse(res.body);

            const episodes = [];
            // Parse initial episodes
            if (data.episodes && data.episodes.length > 0 && data.episodes[0]) {
                data.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.t,
                        season: parseInt(ep.s.replace("S", "")) || 0,
                        episode: parseInt(ep.ep.replace("E", "")) || 0,
                        url: JSON.stringify({ id: ep.id, title: ep.t }),
                        posterUrl: proxyImage(`https://imgcdn.kim/epimg/150/${ep.id}.jpg`)
                    }));
                });

                // Fetch next pages if any
                if (data.nextPageShow === 1 && data.nextPageSeason) {
                    const more = await fetchEpisodes(id, data.nextPageSeason, 2, episodes, cookieStr);
                }

                // Fetch other seasons
                if (data.season && data.season.length > 1) {
                    for (let i = 0; i < data.season.length - 1; i++) {
                        await fetchEpisodes(id, data.season[i].id, 1, episodes, cookieStr);
                    }
                }
            } else {
                // Movie
                episodes.push(new Episode({
                    name: data.title,
                    season: 1,
                    episode: 1,
                    url: JSON.stringify({ id: id, title: data.title }),
                    posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`)
                }));
            }

            const item = new MultimediaItem({
                title: data.title,
                url: urlData,
                posterUrl: proxyImage(`https://imgcdn.kim/poster/v/${id}.jpg`),
                description: data.desc,
                type: episodes.length > 1 ? "tvseries" : "movie",
                year: parseInt(data.year) || undefined,
                episodes: episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function fetchEpisodes(seriesId, seasonId, page, episodes, cookieStr) {
        let pg = page;
        while (true) {
            try {
                const url = `${BASE_URL}/episodes.php?s=${seasonId}&series=${seriesId}&t=${Math.floor(Date.now()/1000)}&page=${pg}`;
                const headers = { ...CommonHeaders, "Cookie": cookieStr };
                const res = await http_get(url, headers);
                const data = JSON.parse(res.body);
                
                if (data.episodes) {
                    data.episodes.forEach(ep => {
                        episodes.push(new Episode({
                            name: ep.t,
                            season: parseInt(ep.s.replace("S", "")) || 0,
                            episode: parseInt(ep.ep.replace("E", "")) || 0,
                            url: JSON.stringify({ id: ep.id, title: ep.t }),
                            posterUrl: proxyImage(`https://imgcdn.kim/epimg/150/${ep.id}.jpg`)
                        }));
                    });
                }
                
                if (data.nextPageShow === 0) break;
                pg++;
            } catch (e) {
                break;
            }
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const { id, title } = JSON.parse(dataStr);
            const hash = await bypass();
            const cookies = { "t_hash_t": hash, "ott": OTT, "hd": "on" };
            const cookieStr = Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join("; ");

            // Step 1: Get 'h' token
            const playRes = await http_post(`${BASE_URL}/play.php`, {
                ...CommonHeaders,
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": cookieStr,
                "Referer": `${BASE_URL}/`
            }, `id=${id}`);
            const playData = JSON.parse(playRes.body);
            const h = playData.h;

            // Step 2: Get 'data-h' from iframe source
            const iframeHeaders = {
                ...CommonHeaders,
                "Referer": `${BASE_URL}/`,
                "Cookie": cookieStr,
                "Upgrade-Insecure-Requests": "1"
            };
            const iframeRes = await http_get(`${PLAY_URL}/play.php?id=${id}&${h}`, iframeHeaders);
            const iframeDoc = await parseHtml(iframeRes.body);
            const token = iframeDoc.querySelector("body")?.getAttribute("data-h");
            if (!token) throw new Error("Could not extract stream token from Step 2");

            // Step 3: Get playlist
            const playlistUrl = `${PLAY_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now()/1000)}&h=${token}`;
            const listRes = await http_get(playlistUrl, { ...CommonHeaders, "Referer": `${PLAY_URL}/play.php?id=${id}&${h}`, "Cookie": cookieStr });
            const playlist = JSON.parse(listRes.body);

            const results = [];
            playlist.forEach(item => {
                if (item.sources) {
                    item.sources.forEach(src => {
                        // Match netmirror.js cleanup: remove /tv/ and ensure double slash after domain if needed
                        // it does source.file.replace("/tv/", "/"); then PLAY_URL + "/" + fullUrl;
                        let fullUrl = src.file.replace("/tv/", "/");
                        if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                        let finalUrl = PLAY_URL + "/" + fullUrl; // Result is net52.cc//hls/...
                        
                        // Use MAGIC_PROXY_v1 to fix the 19s audio-only issue
                        const proxifiedUrl = "MAGIC_PROXY_v1" + btoa(finalUrl);

                        results.push(new StreamResult({
                            url: proxifiedUrl,
                            source: `NetMirror [${src.label}]`,
                            type: "hls",
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Android) ExoPlayer",
                                "Referer": `${PLAY_URL}/`,
                                "Cookie": cookieStr,
                                "Accept": "*/*",
                                "Accept-Encoding": "identity",
                                "Connection": "keep-alive"
                            }
                        }));
                    });
                }
            });

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
