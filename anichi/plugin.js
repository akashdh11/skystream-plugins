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

    // 1. (Optional) Register your plugin settings
    registerSettings([
        { id: "quality", name: "Default Quality", type: "select", options: ["1080p", "720p"], default: "1080p" },
        { id: "prefer_dub", name: "Prefer Dubbed", type: "toggle", default: false }
    ]);

    /**
     * Loads the home screen categories.
     * @param {(res: Response) => void} cb 
     */
    async function getHome(cb) {
        // Example: Using solveCaptcha if needed (await solveCaptcha(siteKey, url))
        try {
            // Dashboard Layout:
            // - "Trending" is a reserved category promoted to the Hero Carousel.
            // - Other categories appear as horizontal thumbnail rows.
            // - If "Trending" is missing, the first category is used for the carousel.
            cb({ 
                success: true, 
                data: { 
                    "Trending": [
                        new MultimediaItem({ 
                            title: "Example Movie (Carousel)", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Trending+Movie`, 
                            type: "movie", // Valid types: movie, series, anime, livestream
                            bannerUrl: `https://placehold.co/1280x720.png?text=Trending+Banner`, // (optional)
                            description: "Plot summary here...", // (optional)
                            headers: { "Referer": `${manifest.baseUrl}` } // (optional)
                        })
                    ],
                    "Latest Series": [
                        new MultimediaItem({ 
                            title: "Example Series (Thumb)", 
                            url: `${manifest.baseUrl}/series`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Series+Poster`, 
                            type: "series",
                            year: 2024,
                            score: 8.5,
                            status: "ongoing", // ongoing, completed, upcoming
                            description: "This category appears as a thumbnail row.",
                            cast: [
                                new Actor({ name: "John Doe", role: "Protagonist", image: "https://..." })
                            ],
                            episodes: [
                                new Episode({
                                    name: "Episode 1",
                                    url: `${manifest.baseUrl}/series/1`,
                                    season: 1,
                                    episode: 1,
                                    airDate: "2024-03-12",
                                    dubStatus: "subbed" // subbed, dubbed, none
                                })
                            ]
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
     * @param {number} page
     * @param {(res: Response) => void} cb 
     */
    async function search(query, page, cb) {
        try {
            // Standard: Return a List of items
            // Samples show both a movie and a series
            cb({ 
                success: true, 
                data: [
                        new MultimediaItem({ 
                            title: "Example Movie (Search Result)", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Search+Movie`, 
                            type: "movie", 
                            bannerUrl: `https://placehold.co/1280x720.png?text=Search+Banner`,
                            description: "Plot summary here...", 
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        }),
                        new MultimediaItem({ 
                            title: "Example Series (Search Result)", 
                            url: `${manifest.baseUrl}/series`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Search+Series`, 
                            type: "series", 
                            description: "A series found in search.", 
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        })
                ] 
            });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.stack });
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
            // Sample shows a series with episodes
            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: "Example Series Full Details",
                    url: url,
                    posterUrl: `https://placehold.co/400x600.png?text=Series+Details`,
                    type: "series", 
                    bannerUrl: `https://placehold.co/1280x720.png?text=Series+Banner`,
                    description: "This is a detailed description of the media.", 
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
                        }),
                        new Episode({ 
                            name: "Episode 2", 
                            url: `${manifest.baseUrl}/watch/2`, 
                            season: 1, 
                            episode: 2, 
                            description: "Next episode summary...", 
                            posterUrl: `https://placehold.co/400x600.png?text=Episode+Poster`,
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        })
                    ]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.stack });
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
                        source: "Server [1080p]", // (optional)
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
