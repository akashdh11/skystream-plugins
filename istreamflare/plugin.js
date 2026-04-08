(function() {
    const BASE_URL = "https://stream.hippitunes.pro";
    const SECRET_KEY = "iSf#2024$Xk9@mNpQrStUvWxYz1234Ab";
    const SALT = "iStreamFlareSalt";
    const API_KEY = "kC7V1f8QRaZyvYnh";
    const CDN_URL = "https://cdn.istreamflare.pro";
    const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
    const APP_UA = "Dalvik/2.1.0 (Linux; U; Android 13; Subsystem for Android(TM) Build/TQ3A.230901.001)";
    
    // Use Browser UA for API/Metadata to bypass bot blocks
    const COMMON_HEADERS = {
        "User-Agent": BROWSER_UA,
        "x-api-key": API_KEY,
        "Referer": BASE_URL + "/"
    };

    let sessionCookies = "";

    /**
     * Decrypts the raw API response using AES/GCM/NoPadding.
     * The payload structure is: IV (12 bytes) + TAG (16 bytes) + Ciphertext (remainder).
     */
    async function decryptPayload(encryptedBase64) {
        if (!encryptedBase64 || encryptedBase64.length < 28) {
             throw new Error("Invalid encrypted payload length");
        }
        
        try {
            const data = base64ToUint8Array(encryptedBase64);
            const iv = data.slice(0, 12);
            const tag = data.slice(12, 28);
            const ciphertext = data.slice(28);
            
            // Standard GCM: Ciphertext + Tag
            const combined = new Uint8Array(ciphertext.length + tag.length);
            combined.set(ciphertext);
            combined.set(tag, ciphertext.length);

            // Phase 1: Derive the actual AES key from the password (SECRET_KEY)
            const saltB64 = uint8ArrayToBase64(stringToUint8Array(SALT));
            const keyB64 = await crypto.pbkdf2(SECRET_KEY, saltB64, 10000, 32);

            // Phase 2: Decrypt with the derived key
            const result = await crypto.decryptAES(
                uint8ArrayToBase64(combined),
                keyB64,
                uint8ArrayToBase64(iv),
                { mode: "gcm" }
            );
            return result;
        } catch (e) {
            throw new Error(`Decryption failed: ${e.message || e}`);
        }
    }

    async function getDecodedJson(endpoint, ignoreErrors = false) {
        const url = `${BASE_URL}/${endpoint}`;
        try {
            const res = await http_get(url, COMMON_HEADERS);
            let body = (res.body || "").trim();
            
            // Safety: Never return raw HTML as JSON
            const lowerBody = body.toLowerCase();
            if (lowerBody.startsWith("<!doctype") || lowerBody.startsWith("<html")) {
                if (ignoreErrors) return null;
                throw new Error(`Invalid non-JSON response (HTML) at ${endpoint}`);
            }

            // Case 1: JSON-wrapped encrypted response {"encrypted":true, "data":"..."}
            if (body.includes('"encrypted":true')) {
                try {
                    const json = JSON.parse(body);
                    if (json.encrypted && json.data) {
                        const decrypted = await decryptPayload(json.data);
                        return JSON.parse(decrypted);
                    }
                } catch (e) {}
            }

            // Case 2: Raw encrypted string (standalone base64)
            // If it is not JSON and not HTML, try decrypting it directly
            if (body && !body.startsWith("{") && !body.startsWith("[")) {
                try {
                    const decrypted = await decryptPayload(body);
                    try {
                        return JSON.parse(decrypted);
                    } catch (e) {
                        return decrypted; // Might be a decrypted plaintext string
                    }
                } catch (e) {
                    // Not encrypted, or decryption failed
                }
            }

            // Case 3: Plain unencrypted JSON
            try {
                const json = JSON.parse(body);
                return json.data || json;
            } catch(e) {
                if (ignoreErrors) return null;
                throw new Error(`Failed to parse JSON response from ${endpoint}`);
            }
        } catch (e) {
            if (ignoreErrors || String(e).includes("404")) {
                return null;
            }
            throw e;
        }
    }

    async function getHome(cb) {
        try {
            const sections = [
                { id: "android/getTrending", name: "Trending" },
                { id: "android/getRecentContentList/Movies", name: "Recently Added Movies" },
                { id: "android/getRecentContentList/WebSeries", name: "Recently Added Webseries" },
                { id: "android/getRandWebSeries", name: "Webseries" },
                { id: "android/getRandMovies", name: "Movies" },
                { id: "android/getAllLiveTV", name: "TV Channels" }
            ];

            const result = {};
            for (const section of sections) {
                try {
                    const data = await getDecodedJson(section.id);
                    if (data && Array.isArray(data)) {
                        result[section.name] = data.map(item => {
                            const isLive = section.id.includes("LiveTV");
                            const isSeries = section.id.includes("WebSeries") || (item.content_type || "").toLowerCase().includes("webseries") || item.type === "2";
                            const contentType = item.content_type || item.type || (isLive ? "LiveTV" : (section.id.includes("Movies") ? "Movies" : "WebSeries"));
                            
                            const loadData = {
                                id: item.id,
                                tmdbId: item.TMDB_ID || item.tmdbId,
                                contentType: contentType,
                                title: item.name,
                                posterUrl: item.poster || item.banner,
                                description: item.description,
                                year: item.year || item.release_year,
                                cast: item.cast ? (typeof item.cast === 'string' ? item.cast.split(",").map(c => c.trim()) : []) : [],
                                url: item.url // Pre-filled for Live TV 
                            };
                            return new MultimediaItem({
                                title: item.name,
                                url: JSON.stringify(loadData),
                                posterUrl: item.poster || item.banner,
                                description: item.description,
                                type: isLive ? "livestream" : (isSeries ? "series" : "movie"),
                                playbackPolicy: "Internal Player Only",
                                year: parseInt(item.year || item.release_year) || undefined,
                                syncData: { tmdb: item.TMDB_ID || item.tmdbId }
                            });
                        });
                    }
                } catch (e) {
                    console.error(`Failed to load section ${section.name}:`, e);
                }
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            // Verified endpoint: android/searchContent/
            const data = await getDecodedJson(`android/searchContent/${encodeURIComponent(query)}/1`);
            const results = (data || []).map(item => {
                const isSeries = (item.content_type || item.contentType || "").toLowerCase().includes("webseries") || item.type === "2";
                const loadData = {
                    id: item.id,
                    tmdbId: item.TMDB_ID || item.tmdbId,
                    contentType: item.content_type || item.contentType || item.type,
                    title: item.name,
                    posterUrl: item.poster || item.banner,
                    description: item.description,
                    year: item.year || item.release_year,
                    cast: item.cast ? (typeof item.cast === 'string' ? item.cast.split(",").map(c => c.trim()) : []) : [],
                    url: item.url // Capture potential direct url
                };
                return new MultimediaItem({
                    title: item.name,
                    url: JSON.stringify(loadData),
                    posterUrl: item.poster || item.banner,
                    description: item.description,
                    type: isSeries ? "series" : "movie",
                    playbackPolicy: "Internal Player Only",
                    year: parseInt(item.year || item.release_year) || undefined,
                    syncData: { tmdb: item.TMDB_ID || item.tmdbId }
                });
            });
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const meta = JSON.parse(url);
            const contentType = String(meta.contentType || "").toLowerCase();
            const isSeries = contentType.includes("webseries") || contentType === "2" || contentType === "series";
            
            const res = new MultimediaItem({
                title: meta.title || meta.name || "Media Details",
                url: url,
                posterUrl: meta.posterUrl || meta.poster,
                description: meta.description,
                type: isSeries ? "series" : "movie",
                playbackPolicy: "Internal Player Only",
                year: parseInt(meta.year) || (meta.release_year ? parseInt(meta.release_year) : undefined),
                syncData: { tmdb: meta.tmdbId },
                cast: (meta.cast && Array.isArray(meta.cast)) 
                    ? meta.cast.map(name => new Actor({ name })) 
                    : []
            });

            if (isSeries) {
                try {
                    const seasons = await getDecodedJson(`android/getSeasons/${meta.id}`, true);
                    const episodes = [];
                    for (const season of (seasons || [])) {
                        try {
                            const epData = await getDecodedJson(`android/getEpisodes/${meta.id}/${season.id}`, true);
                            for (const ep of (epData || [])) {
                                episodes.push(new Episode({
                                    name: ep.name || `Episode ${ep.episode}`,
                                    url: JSON.stringify({ 
                                        id: ep.id, 
                                        contentType: "episode",
                                        url: ep.url,
                                        source: ep.source
                                    }),
                                    season: parseInt(season.season || season.season_order || 1),
                                    episode: parseInt(ep.episode || 0),
                                    playbackPolicy: "Internal Player Only",
                                    posterUrl: ep.thumbnail
                                }));
                            }
                        } catch (e) {
                            console.error(`Failed to load episodes for season ${season.id}:`, e);
                        }
                    }
                    res.episodes = episodes;
                } catch (e) {
                    console.error(`Failed to load seasons for ${meta.id}:`, e);
                }
            } else {
                // Movie Case: Inject a virtual episode to enable the Play button
                res.episodes = [
                    new Episode({
                        name: res.title,
                        url: JSON.stringify({
                            ...meta,
                            // Ensure meta is passed correctly for loadStreams
                        }),
                        season: 1,
                        episode: 1,
                        playbackPolicy: "Internal Player Only",
                        posterUrl: res.posterUrl,
                    })
                ];
            }

            cb({ success: true, data: res });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const meta = JSON.parse(url);
            const streams = [];

            const processLink = (link) => {
                const linkUrl = (link.url || "").trim();
                if (!linkUrl) return;

                const headers = { ...COMMON_HEADERS };
                let host;
                try {
                    host = new URL(linkUrl).origin;
                    headers["Referer"] = host + "/";
                    headers["Origin"] = host;
                } catch (e) {
                    headers["Referer"] = BASE_URL + "/";
                    host = BASE_URL;
                }
                
                if (sessionCookies) {
                    headers["Cookie"] = sessionCookies;
                }
                
                headers["X-Requested-With"] = "com.IStreamFlare";
                headers["Accept"] = "*/*";
                headers["Accept-Language"] = "en-US,en;q=0.9";
                headers["Connection"] = "keep-alive";
                headers["Sec-Fetch-Dest"] = "empty";
                headers["Sec-Fetch-Mode"] = "cors";
                headers["Sec-Fetch-Site"] = "cross-site";

                const sourceLC = (link.source || "").toLowerCase();
                const isDash = sourceLC.includes("dash") || linkUrl.includes(".mpd");
                const isHls = sourceLC.includes("m3u8") || linkUrl.includes(".m3u8") || linkUrl.includes("SeriesHindi.php");
                const type = isDash ? "dash" : (isHls ? "hls" : undefined);
                
                // Push primary link
                streams.push(new StreamResult({
                    url: linkUrl,
                    source: (link.source || link.name || link.server || "Direct") + " (Neuro)",
                    quality: link.quality,
                    type: type,
                    headers: headers
                }));

                // Fallback Host Swap: If link is from neuroflare.de, also try istreamjam.com
                if (linkUrl.includes("stream.neuroflare.de")) {
                    const backupUrl = linkUrl.replace("stream.neuroflare.de", "stream.istreamjam.com");
                    const backupHeaders = { ...headers };
                    const backupHost = "https://stream.istreamjam.com";
                    backupHeaders["Referer"] = backupHost + "/";
                    backupHeaders["Origin"] = backupHost;

                    streams.push(new StreamResult({
                        url: backupUrl,
                        source: (link.source || link.name || link.server || "Direct") + " (Jam)",
                        quality: link.quality,
                        type: type,
                        headers: backupHeaders
                    }));
                }
            };

            // Case 1: Direct URL provided in metadata (Episodes and Live TV)
            if (meta.url && (meta.url.startsWith("http") || meta.url.includes(".php"))) {
                processLink({
                    url: meta.url,
                    source: meta.source || "Direct"
                });
            } else {
                // Case 2: Call play links API (Movies)
                // Official Pattern: android/getMoviePlayLinks/{contentType}/{id}/
                let movieData = await getDecodedJson(`android/getMoviePlayLinks/${meta.contentType}/${meta.id}/`, true);
                
                // Fallback A: No ContentType (Matches some older API models)
                if (!movieData || (Array.isArray(movieData) && movieData.length === 0)) {
                    movieData = await getDecodedJson(`android/getMoviePlayLinks/${meta.id}/`, true);
                }
                
                // Fallback B: Use Tag ID (Matches some specific HDTC releases like Chiraiya/Vaazha)
                if ((!movieData || (Array.isArray(movieData) && movieData.length === 0)) && meta.tagId) {
                    movieData = await getDecodedJson(`android/getMoviePlayLinks/1/${meta.tagId}/`, true);
                }

                if (Array.isArray(movieData)) {
                    movieData.forEach(processLink);
                } else if (movieData) {
                    processLink(typeof movieData === 'string' ? { url: movieData } : movieData);
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    // Standard Helpers
    function stringToUint8Array(str) {
        const arr = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
            arr[i] = str.charCodeAt(i);
        }
        return arr;
    }

    function base64ToUint8Array(base64) {
        const raw = atob(base64);
        const uint8Array = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            uint8Array[i] = raw.charCodeAt(i);
        }
        return uint8Array;
    }

    function uint8ArrayToBase64(uint8Array) {
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary);
    }

    // Export to global scope
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
