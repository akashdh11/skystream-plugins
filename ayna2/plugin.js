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
     * Helper to fetch the M3U playlist.
     */
    async function fetchM3U() {
        const url = `${manifest.baseUrl}/PLAYLIST/AYNA/ayna.php`;
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:78.0) Gecko/20100101 Firefox/78.0",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive"
        };
        const response = await http_get(url, headers);
        const status = response.status !== undefined ? response.status : response.statusCode;
        if (status >= 200 && status < 300) {
            return response.body.trim();
        } else {
            throw new Error(`HTTP Error ${status || 'No Response'} fetching AYNA 2 M3U`);
        }
    }

    /**
     * Helper to parse M3U string into MultimediaItems organized by category.
     */
    function parseM3U(m3uString) {
        const lines = m3uString.split('\n');
        const categories = { "Other Channels": [] };
        let currentChannel = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("#EXTINF:-1")) {
                currentChannel = { 
                    title: "Unknown Channel", 
                    poster: `https://placehold.co/400x600.png?text=No+Logo`, 
                    group: "Other Channels", 
                    headers: {}, 
                    kodiProps: {} 
                };
                
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                if (logoMatch && logoMatch[1]) currentChannel.poster = logoMatch[1];
                
                const groupMatch = line.match(/group-title="([^"]*)"/);
                if (groupMatch && groupMatch[1]) {
                    currentChannel.group = groupMatch[1];
                    if (!categories[currentChannel.group]) categories[currentChannel.group] = [];
                }
                
                const splitName = line.split(",");
                if (splitName.length > 1) currentChannel.title = splitName[splitName.length - 1].trim();
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=")) {
                if (currentChannel) currentChannel.headers["User-Agent"] = line.split("=")[1].trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) {
                if (currentChannel) currentChannel.kodiProps.licenseUrl = line.split("=")[1].trim();
            } else if (line.startsWith("http")) {
                if (currentChannel) {
                    if (line.includes("|")) {
                        const parts = line.split("|");
                        currentChannel.url = parts[0];
                        const headersPart = parts[1];
                        const headerPairs = headersPart.split("&");
                        for (let j = 0; j < headerPairs.length; j++) {
                            const kv = headerPairs[j].split("=");
                            if (kv.length >= 2) currentChannel.headers[kv[0]] = kv.slice(1).join("=");
                        }
                    } else {
                        currentChannel.url = line;
                    }
                    
                    const item = new MultimediaItem({
                        title: currentChannel.title,
                        url: JSON.stringify(currentChannel), // Store state in URL
                        posterUrl: currentChannel.poster,
                        type: "livestream",
                        description: `Live Stream from ${currentChannel.group}`,
                        headers: currentChannel.headers
                    });

                    // Ensure .png for placeholders if logo is empty or generic
                    if (!currentChannel.poster || currentChannel.poster.includes("placehold.co")) {
                        item.posterUrl = `https://placehold.co/400x600.png?text=${encodeURIComponent(currentChannel.title)}`;
                    }

                    categories[currentChannel.group].push(item);
                    currentChannel = null;
                }
            }
        }
        
        const finalOutput = {};
        for (const cat in categories) {
            if (categories[cat].length > 0) {
                finalOutput[cat] = categories[cat];
            }
        }
        return finalOutput;
    }

    /**
     * Loads the home screen categories.
     */
    async function getHome(cb) {
        try {
            const m3u = await fetchM3U();
            const data = parseM3U(m3u);
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message || String(e) });
        }
    }

    /**
     * Searches for media items.
     */
    async function search(query, cb) {
        try {
            const m3u = await fetchM3U();
            const categories = parseM3U(m3u);
            const results = [];
            const q = query.toLowerCase();
            
            for (const cat in categories) {
                categories[cat].forEach(item => {
                    if (item.title.toLowerCase().includes(q)) {
                        results.push(item);
                    }
                });
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message || String(e) });
        }
    }

    /**
     * Loads details for a specific media item.
     */
    async function load(url, cb) {
        try {
            let channelData;
            try {
                channelData = JSON.parse(url);
            } catch (e) {
                channelData = { title: "Live Channel", url: url, poster: "", group: "IPTV" };
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title: channelData.title,
                    url: url, // Keep the same JSON string for loadStreams
                    posterUrl: channelData.poster || `https://placehold.co/400x600.png?text=${encodeURIComponent(channelData.title)}`,
                    type: "livestream",
                    description: `Live TV Channel - ${channelData.group}`,
                    headers: channelData.headers || {},
                    episodes: [
                        new Episode({ 
                            name: "Live", 
                            season: 1, 
                            episode: 1, 
                            url: url, 
                            posterUrl: channelData.poster 
                        })
                    ]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * Resolves streams for a specific media item or episode.
     */
    async function loadStreams(url, cb) {
        try {
            const channelData = JSON.parse(url);
            cb({
                success: true,
                data: [
                    new StreamResult({
                        url: channelData.url,
                        source: "Auto",
                        headers: channelData.headers || {}
                    })
                ]
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
        }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
