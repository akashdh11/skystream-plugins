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


    /**
     * Loads the home screen categories.
     * @param {(res: Response) => void} cb 
     */
    const MAIN_URL = manifest.baseUrl;
    const TRACKER_API = "https://newtrackon.com/api/stable";

    function _parseMovies(html) {
            const results = [], items = html.split('<div class="browse-movie-wrap');
            for (let i = 1; i < items.length; i++) {
                const item = items[i];
                const link = item.match(/href="([^"]+)"/)?.[1], poster = item.match(/src="([^"]+)"/)?.[1], title = item.match(/class="browse-movie-title"[^>]*>([^<]+)</)?.[1];
                if (link && title) {
                    results.push(new MultimediaItem({ 
                        url: link.startsWith("http") ? link : MAIN_URL + link, 
                        title: title.trim(), 
                        posterUrl: poster || "", 
                        type: "movie" 
                    }));
                }
            }
            return results
        }


    async function getHome(cb) {
               try {
                   const sections = [{ t: "Latest Movies", u: "/browse-movies?order_by=latest" }, { t: "Popular Movies", u: "/browse-movies?order_by=downloads" }, { t: "Top Rated Movies", u: "/browse-movies?order_by=rating" }, { t: "4K Movies", u: "/browse-movies?quality=2160p&order_by=latest" }];
                   const home = {};
                   for (const s of sections) {
                       try {
                           const html = await _fetch(MAIN_URL + s.u);
                           const items = _parseMovies(html);
                           if (items.length) home[s.t] = items;
                       } catch (e) {}
                   }
                   cb({ success: true, data: home });
               } catch (e) { cb({ success: false, errorCode: "SITE_OFFLINE", message: e.toString() }); }
    }

    /**
     * Searches for media items.
     * @param {string} query
     * @param {(res: Response) => void} cb 
     */
    async function search(query, cb) {
        try {
            const html = await _fetch(MAIN_URL + "/browse-movies/" + encodeURIComponent(query) + "/all/all/0/latest/0/all");
            cb({ success: true, data: _parseMovies(html) });
        } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR" }); }
    }

    /**
     * Loads details for a specific media item.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function load(url, cb) {
        try {
            const html = await _fetch(url);
            const title = html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() || "Unknown";
            let poster = html.match(/id=["']movie-poster["'][\s\S]*?src=["']([^"']+)["']/)?.[1] || "";
            if (poster && poster.startsWith("/")) poster = MAIN_URL + poster;
            const year = parseInt(html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h2[^>]*>([0-9]{4})<\/h2>/)?.[1] || "0");
            let desc = html.match(/Plot summary<\/[hH][234]>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
            const rating = parseFloat(html.match(/itemprop=["']ratingValue["'][^>]*>([0-9.]+)/)?.[1] || "0.0");
            
            const movie = new MultimediaItem({
                url,
                title,
                posterUrl: poster,
                type: "movie",
                description: desc,
                episodes: [
                    new Episode({
                        name: "Full Movie",
                        url: url,
                        season: 1,
                        episode: 1,
                        posterUrl: poster,
                        description: desc
                    })
                ]
            });
            // Attach extra metadata
            movie.year = year;
            movie.rating = rating;

            cb({ success: true, data: movie });
        } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack }); }
    }

    /**
     * Resolves streams for a specific media item or episode.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function loadStreams(url, cb) {
        try {
            const html = await _fetch(url), links = [], seenHashes = new Set();
            let trackers = ""; try { trackers = await _fetch(TRACKER_API); } catch (e) {}
            const trList = trackers.split("\n").filter(t => t.trim().length > 0);
            const aRegex = /<a[^>]+href="[^"]+\/download\/([a-zA-Z0-9]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
            let m; while ((m = aRegex.exec(html)) !== null) {
                const tag = m[0], hash = m[1]; if (seenHashes.has(hash)) continue; seenHashes.add(hash);
                const tm = tag.match(/title="([^"]*)"/), qt = (m[2].replace(/<[^>]+>/g, "").trim() || (tm ? tm[1] : "")).replace(/Download|Torrent|Magnet|Movie|YIFY/gi, "").trim();
                let q = "Auto"; if (qt.includes("2160p")) q = "4K"; else if (qt.includes("1080p")) q = "1080p"; else if (qt.includes("720p")) q = "720p";
                let mag = "magnet:?xt=urn:btih:" + hash + "&dn=" + hash; trList.forEach(t => mag += "&tr=" + encodeURIComponent(t.trim()));
                links.push(new StreamResult({ url: mag, source: qt || q, headers: {} }));
            }
            if (!links.length) { const mRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/g; while ((m = mRegex.exec(html)) !== null) links.push(new StreamResult({ url: m[1], source: "Magnet", headers: {} })); }
            cb({ success: true, data: links.sort((a,b) => b.quality.includes("1080p") ? 1 : -1) });
        } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack }); }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
