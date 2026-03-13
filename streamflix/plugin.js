(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const FIREBASE_DB = "https://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app";
    const HEADERS = { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36", 
        "Accept": "application/json, text/plain, */*" 
    };

    let cachedData = null, cachedConfig = null;

    async function getData() {
        if (cachedData) return cachedData;
        const res = await http_get(manifest.baseUrl + "/data.json", HEADERS);
        if (res.status === 200) { 
            cachedData = JSON.parse(res.body).data; 
            return cachedData; 
        }
        throw new Error("SITE_OFFLINE");
    }

    async function getConfig() {
        if (cachedConfig) return cachedConfig;
        const res = await http_get(manifest.baseUrl + "/config/config-streamflixapp.json", HEADERS);
        if (res.status === 200) { 
            cachedConfig = JSON.parse(res.body); 
            return cachedConfig; 
        }
        return null;
    }

    async function getHome(cb) {
        try {
            const data = await getData();
            const movies = [], series = [];
            for (const item of data) {
                if (!item.moviename) continue;
                
                const type = item.isTV ? "series" : "movie";
                const poster = item.movieposter ? "https://image.tmdb.org/t/p/w500/" + item.movieposter : "";
                
                const multimedia = new MultimediaItem({ 
                    title: item.moviename, 
                    url: item.moviekey + "|" + type, 
                    posterUrl: poster, 
                    description: item.moviedesc || "", 
                    type: type
                });

                if (item.isTV && series.length < 24) series.push(multimedia);
                else if (!item.isTV && movies.length < 24) movies.push(multimedia);
                
                if (movies.length >= 24 && series.length >= 24) break;
            }
            cb({ success: true, data: { "Latest Movies": movies, "Latest TV Shows": series } });
        } catch (e) { 
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message }); 
        }
    }

    async function search(query, cb) {
        try {
            const data = await getData(), q = query.toLowerCase(), out = [];
            for (const item of data) {
                if (!item.moviename) continue;
                if (item.moviename.toLowerCase().includes(q) || item.movieinfo?.toLowerCase().includes(q)) {
                    const type = item.isTV ? "series" : "movie";
                    const poster = item.movieposter ? "https://image.tmdb.org/t/p/w500/" + item.movieposter : "";
                    
                    out.push(new MultimediaItem({ 
                        title: item.moviename, 
                        url: item.moviekey + "|" + type, 
                        posterUrl: poster, 
                        description: item.moviedesc || "", 
                        type: type
                    }));
                }
                if (out.length > 50) break;
            }
            cb({ success: true, data: out });
        } catch { 
            cb({ success: true, data: [] }); 
        }
    }

    async function load(url, cb) {
        try {
            const [key, type] = url.split("|"), data = await getData();
            const item = data.find(x => x.moviekey == key);
            if (!item) return cb({ success: false, errorCode: "NOT_FOUND" });

            const poster = item.movieposter ? "https://image.tmdb.org/t/p/w500/" + item.movieposter : "";
            const banner = item.moviebanner ? "https://image.tmdb.org/t/p/original/" + item.moviebanner : "";
            
            const episodes = [];

            if (type === "movie") {
                episodes.push(new Episode({ 
                    name: "Full Movie", 
                    url: item.movielink || "", 
                    season: 1, 
                    episode: 1,
                    posterUrl: poster
                }));
            } else {
                let seasonCount = 1; 
                if (item.movieduration) { 
                    const m = item.movieduration.match(/(\d+)\s*Season/); 
                    if (m) seasonCount = parseInt(m[1]); 
                }
                
                for (let s = 1; s <= seasonCount; s++) {
                    const res = await http_get(FIREBASE_DB + "/Data/" + key + "/seasons/" + s + "/episodes.json", {});
                    if (res.status === 200) {
                        const eps = JSON.parse(res.body);
                        if (eps) {
                            for (const k in eps) {
                                const ep = eps[k];
                                const epIndex = parseInt(k) + 1;
                                episodes.push(new Episode({ 
                                    name: ep.name || ("Episode " + epIndex), 
                                    url: ep.link || "", 
                                    season: s, 
                                    episode: epIndex, 
                                    description: ep.overview, 
                                    posterUrl: ep.still_path ? "https://image.tmdb.org/t/p/w500/" + ep.still_path : poster
                                }));
                            }
                        }
                    }
                }
            }

            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: item.moviename,
                    url: url,
                    description: item.moviedesc || "",
                    posterUrl: poster,
                    bannerUrl: banner,
                    type: type,
                    episodes: episodes
                })
            });
        } catch (e) { 
            cb({ success: false, errorCode: "PARSE_ERROR" }); 
        }
    }

    async function loadStreams(url, cb) {
        try {
            const config = await getConfig();
            if (!config) return cb({ success: false, errorCode: "SITE_OFFLINE" });
            
            const results = [];
            
            const add = (list, sub, q) => {
                list?.forEach(baseUrl => {
                    results.push(new StreamResult({ 
                        url: baseUrl + url, 
                        quality: sub + " - " + q, 
                        headers: { 
                            "Referer": manifest.baseUrl, 
                            "User-Agent": HEADERS["User-Agent"] 
                        } 
                    }));
                });
            };

            add(config.premium, "Premium", "720p");
            if (url.includes("/tv/") || url.includes("/episode")) {
                add(config.tv, "TV", "480p");
            } else {
                add(config.movies, "Movies", "480p");
            }
            
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
