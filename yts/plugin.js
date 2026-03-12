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
    async function getHome(cb) {
        try {
            // Standard: Return a Map of Category -> List of items
            cb({ 
                success: true, 
                data: { 
                    "Trending": [
                        new MultimediaItem({ 
                            title: "Example Movie", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `${manifest.baseUrl}/poster.jpg`, 
                            type: "movie", // Valid types: movie, series, anime, livestream
                            bannerUrl: `${manifest.baseUrl}/banner.jpg`, // (optional)
                            description: "Plot summary here...", // (optional)
                            headers: { "Referer": `${manifest.baseUrl}` } // (optional)
                        })
                    ] 
                } 
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: (e instanceof Error) ? e.message : String(e) });
        }
    }

    /**
     * Searches for media items.
     * @param {string} query
     * @param {(res: Response) => void} cb 
     */
    async function search(query, cb) {
        try {
            // Standard: Return a List of items
            cb({ 
                success: true, 
                data: [
                        new MultimediaItem({ 
                            title: "Example Movie", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `${manifest.baseUrl}/poster.jpg`, 
                            type: "movie", // Valid types: movie, series, anime, livestream
                            bannerUrl: `${manifest.baseUrl}/banner.jpg`, // (optional)
                            description: "Plot summary here...", // (optional)
                            headers: { "Referer": `${manifest.baseUrl}` } // (optional)
                        })
                ] 
            });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: (e instanceof Error) ? e.message : String(e) });
        }
    }

    /**
     * Loads details for a specific media item.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    function load(url, cb) {
        try {
            // Standard: Return a single item with full metadata
            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: "Example Movie Full Details",
                    url: url,
                    posterUrl: `${manifest.baseUrl}/poster.jpg`,
                    type: "movie", // Valid types: movie, series, anime, livestream
                    bannerUrl: `${manifest.baseUrl}/banner.jpg`, // (optional)
                    description: "This is a detailed description of the movie.", // (optional)
                    headers: { "Referer": `${manifest.baseUrl}` }, // (optional)
                    episodes: [
                        new Episode({ 
                            name: "Episode 1", 
                            url: `${manifest.baseUrl}/watch/1`, 
                            season: 1, // (optional)
                            episode: 1, // (optional)
                            description: "Episode summary...", // (optional)
                            posterUrl: `${manifest.baseUrl}/ep-poster.jpg`, // (optional)
                            headers: { "Referer": `${manifest.baseUrl}` } // (optional)
                        })
                    ]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: (e instanceof Error) ? e.message : String(e) });
        }
    }

    /**
     * Resolves streams for a specific media item or episode.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function loadStreams(url, cb) {
        try {
            // Standard: Return a List of stream urls
            cb({ 
                success: true, 
                data: [
                    new StreamResult({ 
                        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", 
                        quality: "1080p", // (optional)
                        headers: { "Referer": `${manifest.baseUrl}` }, // (optional)
                        subtitles: [
                            { url: `${manifest.baseUrl}/sub.vtt`, label: "English", lang: "en" } // (optional)
                        ],
                        drmKid: "kid_value", // (optional)
                        drmKey: "key_value", // (optional)
                        licenseUrl: "https://license-server.com" // (optional)
                    })
                ] 
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: (e instanceof Error) ? e.message : String(e) });
        }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
