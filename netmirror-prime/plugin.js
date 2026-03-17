(function() {
    const BASE_URL = "https://net22.cc";
    const PLAY_URL = "https://net52.cc";
    const OTT = "pv";

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
            
            const rowRegex = /<div[^>]*class="[^"]*lolomoRow[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*lolomoRow[^"]*"[^>]*>|$)/g;
            let rowMatch;
            while ((rowMatch = rowRegex.exec(html)) !== null) {
                const rowHtml = rowMatch[1];
                let title = "Trending";
                const titleMatch = rowHtml.match(/<div class="row-header-title">([\s\S]*?)<\/div>/) || 
                             rowHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
                if (titleMatch) {
                    title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
                }
                
                const items = [];
                const imgRegex = /<img[^>]*class="[^"]*lazy[^"]*"[^>]*data-src="([^"]+)"/g;
                let imgMatch;
                while ((imgMatch = imgRegex.exec(rowHtml)) !== null) {
                    const imgSrc = imgMatch[1];
                    const id = imgSrc.split("/").pop().split(".")[0];
                    if (id && !items.some(it => it.url && JSON.parse(it.url).id === id)) {
                        items.push(new MultimediaItem({
                            title: " ", url: JSON.stringify({ id: id }),
                            posterUrl: proxyImage(`https://imgcdn.kim/pv/v/${id}.jpg`), type: "movie"
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
            const url = `${BASE_URL}/pv/search.php?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const results = (data.searchResult || []).map(item => new MultimediaItem({
                title: item.t, url: JSON.stringify({ id: item.id }),
                posterUrl: proxyImage(`https://imgcdn.kim/pv/v/${item.id}.jpg`), type: "movie"
            }));
            cb({ success: true, data: results });
        } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message }); }
    }

    async function load(urlData, cb) {
        try {
            const { id } = JSON.parse(urlData);
            const cookieStr = await getCookieString();
            const url = `${BASE_URL}/pv/post.php?id=${id}&t=${Math.floor(Date.now()/1000)}`;
            const res = await http_get(url, { ...CommonHeaders, "Referer": `${BASE_URL}/tv/home`, "Cookie": cookieStr });
            const data = JSON.parse(res.body);
            const episodes = [];
            if (data.episodes && data.episodes.length > 0 && data.episodes[0]) {
                data.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                        url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/pvepimg/150/${ep.id}.jpg`)
                    }));
                });
                if (data.nextPageShow === 1 && data.nextPageSeason) await fetchEpisodes(id, data.nextPageSeason, 2, episodes, cookieStr);
                if (data.season && data.season.length > 1) {
                    for (let i = 0; i < data.season.length - 1; i++) await fetchEpisodes(id, data.season[i].id, 1, episodes, cookieStr);
                }
            } else {
                episodes.push(new Episode({ name: data.title, season: 1, episode: 1, url: JSON.stringify({ id: id, title: data.title }), posterUrl: proxyImage(`https://imgcdn.kim/pv/v/${id}.jpg`) }));
            }
            cb({ success: true, data: new MultimediaItem({
                title: data.title, url: urlData, posterUrl: proxyImage(`https://imgcdn.kim/pv/v/${id}.jpg`), description: data.desc,
                type: episodes.length > 1 ? "tvseries" : "movie", year: parseInt(data.year) || undefined, episodes: episodes
            })});
        } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: e.message }); }
    }

    async function fetchEpisodes(seriesId, seasonId, page, episodes, cookieStr) {
        let pg = page;
        while (true) {
            try {
                const url = `${BASE_URL}/pv/episodes.php?s=${seasonId}&series=${seriesId}&t=${Math.floor(Date.now()/1000)}&page=${pg}`;
                const res = await http_get(url, { ...CommonHeaders, "Cookie": cookieStr });
                const data = JSON.parse(res.body);
                if (data.episodes) {
                    data.episodes.forEach(ep => {
                        episodes.push(new Episode({
                            name: ep.t, season: parseInt(ep.s?.replace("S", "")) || 0, episode: parseInt(ep.ep?.replace("E", "")) || 0,
                            url: JSON.stringify({ id: ep.id, title: ep.t }), posterUrl: proxyImage(`https://imgcdn.kim/pvepimg/150/${ep.id}.jpg`)
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
            const playPostRes = await http_post(`${BASE_URL}/play.php`, { ...CommonHeaders, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/`, "Cookie": cookieStrInitial }, `id=${id}`);
            const { h } = JSON.parse(playPostRes.body);
            const iframeRes = await http_get(`${PLAY_URL}/play.php?id=${id}&${h}`, { ...CommonHeaders, "Referer": `${BASE_URL}/`, "Cookie": cookieStrInitial });
            const tokenMatch = iframeRes.body.match(/data-h="([^"]+)"/);
            const token = tokenMatch ? tokenMatch[1] : "";
            const playlistUrl = `${PLAY_URL}/pv/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now()/1000)}&h=${token}`;
            const listRes = await http_get(playlistUrl, { ...CommonHeaders, "Referer": `${PLAY_URL}/`, "Cookie": cookieStrInitial });
            const playlist = JSON.parse(listRes.body);
            const results = [];
            playlist.forEach(item => {
                if (item.sources) {
                    item.sources.forEach(src => {
                        let fullUrl = src.file.replace("/tv/", "/");
                        if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                        const finalUrl = PLAY_URL + "/" + fullUrl;

                        const inMatch = src.file.match(/[?&]in=([^&]+)/);
                        let streamHash = globalHash;
                        if (inMatch) streamHash = decodeURIComponent(inMatch[1]);
                        const streamCookieStr = `t_hash_t=${streamHash}; ott=${OTT}; hd=on`;

                        const proxifiedUrl = "MAGIC_PROXY_v1" + btoa(finalUrl);
                        results.push(new StreamResult({
                            url: proxifiedUrl, source: `NetMirror [${src.label}]`, type: "hls",
                            headers: { 
                                "User-Agent": "Mozilla/5.0 (Android) ExoPlayer", 
                                "Referer": `${PLAY_URL}/`, 
                                "Cookie": streamCookieStr,
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
