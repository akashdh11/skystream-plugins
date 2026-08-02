(function() {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const MAIN_URL = String((typeof manifest !== "undefined" && manifest?.baseUrl) || "https://yts.gg").replace(/\/+$/, "");
    const API_BASES = [`${MAIN_URL}/api/v2`, "https://movies-api.accel.li/api/v2"];
    const TRACKER_API = "https://newtrackon.com/api/stable";

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    const HEADERS = {
        "User-Agent": USER_AGENT,
        "Referer": `${MAIN_URL}/`,
        "Origin": MAIN_URL,
        "Accept": "application/json, text/html, */*"
    };

    async function _fetch(url) {
        const res = await http_get(url, {
            ...HEADERS,
            headers: HEADERS
        });
        return res.body || "";
    }

    async function _fetchJson(endpointPath) {
        for (const base of API_BASES) {
            try {
                const fullUrl = base + endpointPath;
                const body = await _fetch(fullUrl);
                const json = JSON.parse(body);
                if (json && json.status === "ok") {
                    return json;
                }
            } catch (e) {}
        }
        return null;
    }

    function _formatMovieFromApi(movie) {
        if (!movie) return null;
        const movieUrl = movie.url || `${MAIN_URL}/movies/${movie.slug || movie.id}`;
        const poster = movie.large_cover_image || movie.medium_cover_image || movie.small_cover_image || "";
        return new MultimediaItem({
            url: movieUrl,
            title: (movie.title || movie.title_english || "Unknown").trim(),
            posterUrl: poster,
            type: "movie",
            description: movie.summary || movie.description_full || movie.synopsis || "",
            year: movie.year || 0,
            score: movie.rating || 0
        });
    }

    function _parseMoviesFromHtml(html) {
        const results = [], items = html.split('<div class="browse-movie-wrap');
        for (let i = 1; i < items.length; i++) {
            const item = items[i];
            const link = item.match(/href="([^"]+)"/)?.[1];
            const poster = item.match(/src="([^"]+)"/)?.[1] || item.match(/data-src="([^"]+)"/)?.[1];
            const title = item.match(/class="browse-movie-title"[^>]*>([^<]+)</)?.[1];
            if (link && title) {
                const movieUrl = link.startsWith("http") ? link : MAIN_URL + (link.startsWith("/") ? "" : "/") + link;
                const posterUrl = poster ? (poster.startsWith("http") ? poster : MAIN_URL + (poster.startsWith("/") ? "" : "/") + poster) : "";
                results.push(new MultimediaItem({ 
                    url: movieUrl, 
                    title: title.trim(), 
                    posterUrl: posterUrl, 
                    type: "movie" 
                }));
            }
        }
        return results;
    }

    async function _getMovieByUrlOrSlug(url) {
        const slugMatch = url.match(/\/movies\/([^\/\?#]+)/);
        const slug = slugMatch ? slugMatch[1] : "";
        if (!slug) return null;

        const cleanQuery = slug.replace(/-\d{4}$/, '').replace(/-/g, ' ');
        const queries = [cleanQuery, slug.replace(/-/g, ' '), slug];

        for (const q of queries) {
            if (!q.trim()) continue;
            const json = await _fetchJson(`/list_movies.json?query_term=${encodeURIComponent(q)}`);
            if (json && json.data && Array.isArray(json.data.movies) && json.data.movies.length > 0) {
                const matched = json.data.movies.find(m => m.slug === slug || m.url === url) || json.data.movies[0];
                return matched;
            }
        }
        return null;
    }

    /**
     * Loads the home screen categories.
     * @param {(res: Response) => void} cb 
     */
    async function getHome(cb) {
        try {
            const sections = [
                { title: "Latest Movies", api: "/list_movies.json?sort_by=date_added&limit=20", html: "/browse-movies?order_by=latest" },
                { title: "Popular Movies", api: "/list_movies.json?sort_by=download_count&limit=20", html: "/browse-movies?order_by=downloads" },
                { title: "Top Rated Movies", api: "/list_movies.json?sort_by=rating&limit=20", html: "/browse-movies?order_by=rating" },
                { title: "4K Movies", api: "/list_movies.json?quality=2160p&limit=20", html: "/browse-movies?quality=2160p&order_by=latest" }
            ];

            const home = {};
            for (const s of sections) {
                try {
                    let items = [];
                    // Try API first
                    const json = await _fetchJson(s.api);
                    if (json && json.data && Array.isArray(json.data.movies)) {
                        items = json.data.movies.map(_formatMovieFromApi).filter(Boolean);
                    }
                    // Fallback to HTML scraping
                    if (!items.length) {
                        const html = await _fetch(MAIN_URL + s.html);
                        items = _parseMoviesFromHtml(html);
                    }
                    if (items.length) {
                        home[s.title] = items;
                    }
                } catch (e) {}
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.toString() });
        }
    }

    /**
     * Searches for media items.
     * @param {string} query
     * @param {(res: Response) => void} cb 
     */
    async function search(query, cb) {
        try {
            let results = [];
            // Try API first
            const json = await _fetchJson(`/list_movies.json?query_term=${encodeURIComponent(query)}`);
            if (json && json.data && Array.isArray(json.data.movies)) {
                results = json.data.movies.map(_formatMovieFromApi).filter(Boolean);
            }
            // Fallback to HTML scraping
            if (!results.length) {
                const html = await _fetch(`${MAIN_URL}/browse-movies/${encodeURIComponent(query)}/all/all/0/latest/0/all`);
                results = _parseMoviesFromHtml(html);
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    /**
     * Loads details for a specific media item.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function load(url, cb) {
        try {
            const apiMovie = await _getMovieByUrlOrSlug(url);
            let movie = apiMovie ? _formatMovieFromApi(apiMovie) : null;

            // Fallback to HTML scraping if API failed
            if (!movie) {
                const html = await _fetch(url);
                const title = html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim()
                           || html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim()
                           || "Unknown";
                let poster = html.match(/id=["']movie-poster["'][\s\S]*?src=["']([^"']+)["']/)?.[1]
                          || html.match(/class=["'][^"']*poster[^"']*["'][\s\S]*?src=["']([^"']+)["']/)?.[1]
                          || "";
                if (poster && !poster.startsWith("http")) poster = MAIN_URL + (poster.startsWith("/") ? "" : "/") + poster;
                const year = parseInt(html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h2[^>]*>([0-9]{4})<\/h2>/)?.[1]
                           || html.match(/<h2[^>]*>([0-9]{4})<\/h2>/)?.[1]
                           || "0");
                let desc = html.match(/Plot summary<\/[hH][234]>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim()
                        || html.match(/id=["']movie-synopsis["'][^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, "").trim()
                        || "";
                const rating = parseFloat(html.match(/itemprop=["']ratingValue["'][^>]*>([0-9.]+)/)?.[1]
                            || html.match(/class=["'][^"']*rating[^"']*["'][^>]*>([0-9.]+)/)?.[1]
                            || "0.0");
                
                movie = new MultimediaItem({
                    url,
                    title,
                    posterUrl: poster,
                    type: "movie",
                    description: desc,
                    year: year,
                    score: rating
                });
            }

            movie.episodes = [
                new Episode({
                    name: "Full Movie",
                    url: url,
                    season: 1,
                    episode: 1,
                    posterUrl: movie.posterUrl,
                    description: movie.description
                })
            ];

            cb({ success: true, data: movie });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack || e.toString() });
        }
    }

    /**
     * Resolves streams for a specific media item or episode.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function loadStreams(url, cb) {
        try {
            const links = [];
            const seenHashes = new Set();

            let trackers = "";
            try { trackers = await _fetch(TRACKER_API); } catch (e) {}
            const trList = trackers.split("\n").filter(t => t.trim().length > 0);
            if (!trList.length) {
                trList.push(
                    "udp://open.demonii.com:1337/announce",
                    "udp://tracker.openbittorrent.com:80",
                    "udp://tracker.coppersurfer.tk:6969",
                    "udp://glotorrents.pw:6969/announce",
                    "udp://tracker.opentrackr.org:1337/announce",
                    "udp://torrent.gresille.org:80/announce"
                );
            }

            function buildMagnet(hash, title) {
                let mag = "magnet:?xt=urn:btih:" + hash + "&dn=" + encodeURIComponent(title || hash);
                trList.forEach(t => mag += "&tr=" + encodeURIComponent(t.trim()));
                return mag;
            }

            // 1. API Lookup for torrents
            const apiMovie = await _getMovieByUrlOrSlug(url);
            if (apiMovie && Array.isArray(apiMovie.torrents)) {
                for (const tor of apiMovie.torrents) {
                    if (tor.hash && !seenHashes.has(tor.hash.toUpperCase())) {
                        const hash = tor.hash.toUpperCase();
                        seenHashes.add(hash);
                        const q = tor.quality || "720p";
                        const typeStr = tor.type ? ` [${tor.type.toUpperCase()}]` : "";
                        const sizeStr = tor.size ? ` (${tor.size})` : "";
                        const label = `YTS ${q}${typeStr}${sizeStr}`;
                        links.push(new StreamResult({
                            url: buildMagnet(hash, apiMovie.title || hash),
                            source: label,
                            headers: {}
                        }));
                    }
                }
            }

            // 2. HTML Scraper Fallback
            const html = await _fetch(url);
            const aRegex = /<a[^>]+href="[^"]*?\/(?:torrent\/)?download\/([a-zA-Z0-9]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
            let m;
            while ((m = aRegex.exec(html)) !== null) {
                const tag = m[0], hash = m[1].toUpperCase();
                if (seenHashes.has(hash)) continue;
                seenHashes.add(hash);
                const tm = tag.match(/title="([^"]*)"/);
                const qt = (m[2].replace(/<[^>]+>/g, "").trim() || (tm ? tm[1] : "")).replace(/Download|Torrent|Magnet|Movie|YIFY/gi, "").trim();
                let q = "Auto";
                if (qt.includes("2160p") || qt.includes("4K")) q = "4K";
                else if (qt.includes("1080p")) q = "1080p";
                else if (qt.includes("720p")) q = "720p";
                links.push(new StreamResult({
                    url: buildMagnet(hash, hash),
                    source: qt || q,
                    headers: {}
                }));
            }

            if (!links.length) {
                const mRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/g;
                while ((m = mRegex.exec(html)) !== null) {
                    links.push(new StreamResult({ url: m[1], source: "Magnet", headers: {} }));
                }
            }

            // Sort results: 2160p/4K first, then 1080p, then 720p
            links.sort((a, b) => {
                const sA = a.source || "", sB = b.source || "";
                if (sA.includes("2160p") || sA.includes("4K")) return -1;
                if (sB.includes("2160p") || sB.includes("4K")) return 1;
                if (sA.includes("1080p")) return -1;
                if (sB.includes("1080p")) return 1;
                return 0;
            });

            cb({ success: true, data: links });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack || e.toString() });
        }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
