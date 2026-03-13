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
            // Note: "Trending" is a reserved category promoted to the Hero Carousel.
            // Other categories appear as horizontal thumbnail rows.
            // If "Trending" is missing, the first available category is used for the carousel.
            cb({ 
                success: true, 
                data: { 
                    "Trending": [
                        new MultimediaItem({ 
                            title: "Example Movie (Carousel)", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Trending+Poster`, 
                            type: "movie",
                            bannerUrl: `https://placehold.co/1280x720.png?text=Trending+Banner`, 
                            description: "This item appears in the top carousel because it's in 'Trending'.",
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        })
                    ],
                    "Editor's Choice": [
                        new MultimediaItem({ 
                            title: "Featured Item (Thumbnail)", 
                            url: `${manifest.baseUrl}/featured`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Thumbnail+Poster`, 
                            type: "movie",
                            description: "This item appears in a thumbnail row.",
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        })
                    ]
                } 
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
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
                            posterUrl: `https://placehold.co/400x600.png?text=Search+Poster`, 
                            type: "movie", 
                            bannerUrl: `https://placehold.co/1280x720.png?text=Search+Banner`,
                            description: "Plot summary here...", 
                            headers: { "Referer": `${manifest.baseUrl}` } 
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
    async function load(url, cb) {
        try {
            // Standard: Return a single item with full metadata
            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: "Example Movie Full Details",
                    url: url,
                    posterUrl: `https://placehold.co/400x600.png?text=Details+Poster`,
                    type: "movie", 
                    bannerUrl: `https://placehold.co/1280x720.png?text=Details+Banner`,
                    description: "This is a detailed description of the movie.", 
                    headers: { "Referer": `${manifest.baseUrl}` }, 
                    episodes: [
                        new Episode({ 
                            name: "Episode 1", 
                            url: `${manifest.baseUrl}/watch/1`, 
                            season: 1, 
                            episode: 1, 
                            description: "Episode summary...", 
                            posterUrl: `https://placehold.co/400x600.png?text=Episode+Poster`,
                            headers: { "Referer": `${manifest.baseUrl}` } 
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
