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
                            title: "Example Series (Thumbnail)", 
                            url: `${manifest.baseUrl}/series`, 
                            posterUrl: `https://placehold.co/400x600.png?text=Series+Poster`, 
                            type: "series",
                            description: "This is a sample series with episodes.",
                            headers: { "Referer": `${manifest.baseUrl}` },
                            episodes: [
                                new Episode({ 
                                    name: "Pilot", 
                                    url: `${manifest.baseUrl}/series/s1e1`, 
                                    season: 1, 
                                    episode: 1, 
                                    posterUrl: `https://placehold.co/400x600.png?text=EP1+Poster` 
                                }),
                                new Episode({ 
                                    name: "The Encounter", 
                                    url: `${manifest.baseUrl}/series/s1e2`, 
                                    season: 1, 
                                    episode: 2, 
                                    posterUrl: `https://placehold.co/400x600.png?text=EP2+Poster` 
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
     * @param {(res: Response) => void} cb 
     */
    async function search(query, cb) {
        try {
            // Standard: Return a List of items
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
            // Note: If this were a series, you'd populate episodes here.
            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: "Example Series Full Details",
                    url: url,
                    posterUrl: `https://placehold.co/400x600.png?text=Series+Details`,
                    type: "series", 
                    bannerUrl: `https://placehold.co/1280x720.png?text=Series+Banner`,
                    description: "This is a detailed description of the series.", 
                    headers: { "Referer": `${manifest.baseUrl}` }, 
                    episodes: [
                        new Episode({ 
                            name: "Pilot Episode", 
                            url: `${manifest.baseUrl}/watch/s1e1`, 
                            season: 1, 
                            episode: 1, 
                            description: "The beginning of the journey.", 
                            posterUrl: `https://placehold.co/400x600.png?text=EP1+Poster`,
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        }),
                        new Episode({ 
                            name: "The Encounter", 
                            url: `${manifest.baseUrl}/watch/s1e2`, 
                            season: 1, 
                            episode: 2, 
                            description: "Things get complicated.", 
                            posterUrl: `https://placehold.co/400x600.png?text=EP2+Poster`,
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
