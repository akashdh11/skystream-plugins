(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const BASE_URL = "https://net22.cc";
    const PLAY_URL = "https://net52.cc";

    const CommonHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    let cachedCookie = "";
    let lastBypassTime = 0;
    const COOKIE_EXPIRY = 3600000 * 12; // 12 hours

    async function bypass() {
        const now = Date.now();
        if (cachedCookie && (now - lastBypassTime < COOKIE_EXPIRY)) {
            return cachedCookie;
        }

        console.log("[NetMirror] Bypassing authentication...");
        for (let i = 0; i < 5; i++) {
            try {
                const res = await http_post(`${PLAY_URL}/tv/p.php`, { ...CommonHeaders, "X-Requested-With": "XMLHttpRequest" }, "");
                // console.log("[NetMirror] Bypass Resp Headers: " + JSON.stringify(res.headers));
                if (res.body && res.body.includes('"r":"n"')) {
                    const setCookie = res.headers['set-cookie'] || res.headers['Set-Cookie'] || res.headers['set-cookie'] || "";
                    let cookie = "";
                    if (Array.isArray(setCookie)) {
                        cookie = setCookie.find(c => c.includes('t_hash_t=')) || "";
                    } else if (typeof setCookie === 'string') {
                        cookie = setCookie;
                    }
                    
                    const match = cookie.match(/t_hash_t=([^;]+)/);
                    if (match) {
                        cachedCookie = match[1];
                        lastBypassTime = Date.now();
                        return cachedCookie;
                    }
                }
            } catch (e) {
                console.error("[NetMirror] Bypass attempt failed:", e.message);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error("Failed to bypass NetflixMirror authentication");
    }

    async function getCookieString() {
        const hash = await bypass();
        const cookies = {
            "t_hash_t": hash,
            "user_token": "233123f803cf02184bf6c67e149cdd50",
            "ott": "nf",
            "hd": "on"
        };
        return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
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
            
            const results = {};
            for (const row of rows) {
                const title = row.querySelector("h2.rowHeader")?.textContent.trim() || "Suggest";
                const items = Array.from(row.querySelectorAll("img.lazy")).map(img => {
                    const dataSrc = img.getAttribute("data-src") || "";
                    const id = dataSrc.split("/").pop().split(".")[0];
                    if (!id) return null;
                    return new MultimediaItem({
                        title: "", // Title often not in home row, will load on demand
                        url: JSON.stringify({ id }),
                        posterUrl: `https://imgcdn.media/poster/v/${id}.jpg`,
                        type: "movie" // Default to movie, load() will fix
                    });
                }).filter(i => i !== null);
                
                if (items.length > 0) results[title] = items;
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
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
            const items = (data.searchResult || []).map(item => {
                return new MultimediaItem({
                    title: item.t,
                    url: JSON.stringify({ id: item.id }),
                    posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`,
                    type: "movie"
                });
            });
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: true, data: [] });
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
            
            const isSeries = data.episodes && data.episodes.length > 0 && data.episodes[0] !== null;
            
            if (!isSeries) {
                episodes.push(new Episode({
                    name: data.title,
                    season: 1,
                    episode: 1,
                    url: JSON.stringify({ id, title: data.title })
                }));
            } else {
                // Initial episodes
                data.episodes.filter(e => e !== null).forEach(e => {
                    episodes.push(new Episode({
                        name: e.t,
                        season: parseInt(e.s.replace("S", "")) || 1,
                        episode: parseInt(e.ep.replace("E", "")) || 1,
                        url: JSON.stringify({ id: e.id, title: e.t }),
                        posterUrl: `https://imgcdn.media/epimg/150/${e.id}.jpg`
                    }));
                });

                // Pagination & Other Seasons
                const tasks = [];
                if (data.nextPageShow === 1 && data.nextPageSeason) {
                    tasks.push(fetchEpisodes(id, data.nextPageSeason, 2, episodes, cookieStr));
                }
                if (data.season && data.season.length > 1) {
                    data.season.slice(0, -1).forEach(s => {
                        tasks.push(fetchEpisodes(id, s.id, 1, episodes, cookieStr));
                    });
                }
                await Promise.all(tasks);
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title: data.title,
                    url: urlData,
                    posterUrl: `https://imgcdn.media/poster/v/${id}.jpg`,
                    description: data.desc,
                    year: parseInt(data.year),
                    type: isSeries ? "tvseries" : "movie",
                    episodes: episodes.sort((a,b) => (a.season - b.season) || (a.episode - b.episode))
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
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
                if (!data.episodes) break;
                
                data.episodes.filter(e => e !== null).forEach(e => {
                    episodes.push(new Episode({
                        name: e.t,
                        season: parseInt(e.s.replace("S", "")) || 1,
                        episode: parseInt(e.ep.replace("E", "")) || 1,
                        url: JSON.stringify({ id: e.id, title: e.t }),
                        posterUrl: `https://imgcdn.media/epimg/150/${e.id}.jpg`
                    }));
                });
                if (data.nextPageShow === 0) break;
                pg++;
            } catch (e) { break; }
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const { id, title } = JSON.parse(dataStr);
            const hash = await bypass();
            const cookies = { "t_hash_t": hash, "ott": "nf", "hd": "on" };
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
                        results.push(new StreamResult({
                            url: PLAY_URL + src.file,
                            source: `NetMirror [${src.label}]`,
                            type: "hls",
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Android) ExoPlayer",
                                "Referer": `${PLAY_URL}/`,
                                "Cookie": "hd=on"
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
