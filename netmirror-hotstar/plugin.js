(function() {
    const BASE_URL = "https://net22.cc";
    const PLAY_URL = "https://net52.cc";
    const OTT = "hs";

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
                        cachedCookie = match[1];
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
            const res = await http_get(`${BASE_URL}/mobile/home`, { ...CommonHeaders, "Referer": `${BASE_URL}/home`, "Cookie": cookieStr });
            const doc = await parseHtml(res.body);
            const sections = {};
            
            const containers = Array.from(doc.querySelectorAll(".tray-container, #top10"));
            containers.forEach(container => {
                const title = container.querySelector("h2, span")?.textContent?.trim() || "Recommended";
                const items = Array.from(container.querySelectorAll("article, .top10-post")).map(article => {
                    const id = article.querySelector("a")?.getAttribute("data-post") || article.getAttribute("data-post");
                    if (!id) return null;
                    return new MultimediaItem({
                        title: " ",
                        url: JSON.stringify({ id: id }),
                        posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${id}.jpg`),
                        type: "movie"
                    });
                }).filter(i => i !== null);
                if (items.length > 0) sections[title] = items;
            });
            cb({ success: true, data: sections });
        } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: e.message }); }
    }

    async function search(query, cb) {
        try {
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/mobile/hs/search.php?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const results = (data.searchResult || []).map(item => new MultimediaItem({
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
            const url = `${BASE_URL}/mobile/hs/post.php?id=${id}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/home`, "Cookie": cookieStr });
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
            cb({ success: true, data: new MultimediaItem({
                title: data.title, url: urlData, posterUrl: proxyImage(`https://imgcdn.kim/hs/v/${id}.jpg`), description: data.desc,
                type: episodes.length > 1 ? "tvseries" : "movie", year: parseInt(data.year) || undefined, episodes: episodes
            })});
        } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: e.message }); }
    }

    async function fetchEpisodes(seriesId, seasonId, page, episodes, cookieStr) {
        let pg = page;
        while (true) {
            try {
                const url = `${BASE_URL}/mobile/hs/episodes.php?s=${seasonId}&series=${seriesId}&t=${Math.floor(Date.now()/1000)}&page=${pg}`;
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
            const hash = await bypass();
            const cookieStr = `t_hash_t=${hash}; ott=${OTT}; hd=on`;
            const listRes = await http_get(`${PLAY_URL}/mobile/hs/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now()/1000)}`, { ...CommonHeaders, "Referer": `${BASE_URL}/`, "Cookie": cookieStr });
            const playlist = JSON.parse(listRes.body);
            const results = [];
            playlist.forEach(item => {
                if (item.sources) {
                    item.sources.forEach(src => {
                        let fullUrl = src.file.replace("/tv/", "/");
                        if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                        const finalUrl = PLAY_URL + "/" + fullUrl;

                        const proxifiedUrl = "MAGIC_PROXY_v1" + btoa(finalUrl);
                        results.push(new StreamResult({
                            url: proxifiedUrl, source: `NetMirror [${src.label}]`, type: "hls",
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
        } catch (e) { cb({ success: false, errorCode: "STREAM_ERROR", message: e.message }); }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
