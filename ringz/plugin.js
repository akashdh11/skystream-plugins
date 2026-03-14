(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const commonHeaders = {
        "cf-access-client-id": "e3a15ad999dab7f3592f3d855e0ec6ed.access",
        "cf-access-client-secret": "8a22536e2dac86369a2caa911d55a89a109939cc69e6646e51bf5d8527a1dca5",
        "user-agent": "Dart/3.8 (dart:io)"
    };

    async function fetchCats() {
        try {
            const res = await http_get("https://raw.githubusercontent.com/phisher98/TVVVV/main/RingzCategories.json", {});
            if (res && res.status >= 200 && res.status < 300) {
                return JSON.parse(res.body);
            }
        } catch {}
        return [
            { "url": "Nwm.json", "title": "Movies" },
            { "url": "Nws.json", "title": "Web Series" },
            { "url": "lstanime.json", "title": "Anime" }
        ];
    }

    function parseItems(json, catTitle, sourceUrl) {
        const lists = [json.AllMovieDataList, json.allMovieDataList, json.webSeriesDataList], items = [];
        lists.forEach(l => {
            if (!l || !Array.isArray(l)) return;
            l.forEach(i => {
                if (!i.mn) return;
                const type = catTitle.toLowerCase().includes("movie") ? "movie" : "tvseries";
                items.push(new MultimediaItem({
                    title: i.mn,
                    url: JSON.stringify({ ...i, type, sourceUrl }),
                    posterUrl: i.IH,
                    description: i.gn,
                    type: type
                }));
            });
        });
        return items;
    }

    async function getHome(cb) {
        try {
            const cats = await fetchCats();
            const valid = cats.filter(c => !(c.adult === true || c.title.includes("Adult")));
            if (!valid.length) return cb({ success: true, data: {} });

            const results = {};
            const promises = valid.map(async (c) => {
                try {
                    const u = c.url.startsWith("http") ? c.url : `${manifest.baseUrl}/${c.url}`;
                    const res = await http_get(u, commonHeaders);
                    if (res && res.status === 200) {
                        const items = parseItems(JSON.parse(res.body), c.title, u);
                        if (items.length) results[c.title] = items;
                    }
                } catch (e) {
                    console.error(`RingZ: Error fetching ${c.title}: ${e.message}`);
                }
            });

            await Promise.all(promises);
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const cats = await fetchCats();
            const q = query.toLowerCase();
            const valid = cats.filter(c => !(c.adult === true || c.title.includes("Adult")));
            if (!valid.length) return cb({ success: true, data: [] });

            const results = [];
            const promises = valid.map(async (c) => {
                try {
                    const u = c.url.startsWith("http") ? c.url : `${manifest.baseUrl}/${c.url}`;
                    const res = await http_get(u, commonHeaders);
                    if (res && res.status === 200) {
                        parseItems(JSON.parse(res.body), c.title, u).forEach(item => {
                            if (item.title.toLowerCase().includes(q)) results.push(item);
                        });
                    }
                } catch (e) {
                    console.error(`RingZ: Search error in ${c.title}: ${e.message}`);
                }
            });

            await Promise.all(promises);
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: true, data: [] });
        }
    }

    async function load(urlStr, cb) {
        try {
            const data = JSON.parse(urlStr);
            const isMovie = data.type === "movie";
            let fUrl = data.l || data.sourceUrl;
            if (fUrl && !fUrl.startsWith("http")) fUrl = `${manifest.baseUrl}/${fUrl}`;

            const res = await http_get(fUrl, commonHeaders);
            if (!res || res.status !== 200) return cb({ success: false, errorCode: "SITE_OFFLINE" });

            const json = JSON.parse(res.body);
            const list = json.AllMovieDataList || json.allMovieDataList || json.webSeriesDataList || [];
            const item = list.find(i => i.id == data.id);
            if (!item) return cb({ success: false, errorCode: "PARSE_ERROR" });

            const episodes = [];
            if (isMovie) {
                const links = [];
                for (let k in item) {
                    const v = item[k];
                    if (typeof v === "string" && v.startsWith("http") && !["IH", "IV", "CIF", "Poster", "trailer"].includes(k)) {
                        let name = k;
                        if (k.includes("480")) name = "480p - " + k; 
                        else if (k.includes("720")) name = "720p - " + k; 
                        else if (k.includes("1080")) name = "1080p - " + k;
                        links.push({ key: k, url: v, name });
                    }
                }
                episodes.push(new Episode({ 
                    name: "Full Movie", 
                    url: JSON.stringify(links), 
                    season: 1, 
                    episode: 1, 
                    posterUrl: data.IH 
                }));
            } else {
                const em = {};
                for (let k in item) {
                    if (k.startsWith("eServer") || k === "eTape") {
                        const block = item[k];
                        for (let n in block) {
                            if (!em[n]) em[n] = [];
                            em[n].push({ source: k, url: block[n], episode: n });
                        }
                    }
                }
                for (let n in em) {
                    episodes.push(new Episode({ 
                        name: "Episode " + n, 
                        season: 1, 
                        episode: parseInt(n), 
                        url: JSON.stringify(em[n]), 
                        posterUrl: data.IH 
                    }));
                }
                episodes.sort((a,b) => a.episode - b.episode);
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title: data.mn,
                    url: urlStr,
                    posterUrl: data.IH,
                    description: data.gn,
                    type: data.type,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const data = JSON.parse(dataStr);
            const results = [];
            data.forEach(it => {
                const u = it.url || it.value;
                const k = it.key || it.source || it.name;
                if (u && u.startsWith("http")) {
                    const qLabels = [u, k, it.value].map(s => s ? s.toLowerCase() : "");
                    const q = qLabels.some(s => s.includes("2160") || s.includes("4k")) ? "4K" : 
                              qLabels.some(s => s.includes("1080")) ? "1080p" : 
                              qLabels.some(s => s.includes("720")) ? "720p" : 
                              qLabels.some(s => s.includes("480")) ? "480p" : "Auto";
                    
                    results.push(new StreamResult({
                        source: q,
                        url: u,
                        headers: commonHeaders
                    }));
                }
            });
            cb({ success: true, data: results });
        } catch {
            cb({ success: true, data: [] });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
