(function() {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" };

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === 'object') return data;
        try { return JSON.parse(data); } catch (e) { return null; }
    }

    function toMedia(element, type = "anime") {
        const lnk = element.querySelector('a.lnk-blk') || element.querySelector('a.watch-btn') || element.querySelector('a.fa-play-circle') || element.querySelector('a');
        if (!lnk) return null;
        const href = lnk.getAttribute('href');
        const title = element.querySelector('header h2')?.textContent?.trim() || element.querySelector('.entry-title')?.textContent?.trim() || "Untitled";
        const img = element.querySelector('div.post-thumbnail figure img') || element.querySelector('figure img') || element.querySelector('img');
        let poster = img?.getAttribute('src');
        if (poster?.startsWith('data:image')) {
            poster = img?.getAttribute('data-lazy-src') || img?.getAttribute('data-src');
        }

        return new MultimediaItem({
            title: title,
            url: JSON.stringify({ url: href, poster: poster }),
            posterUrl: poster,
            type: type
        });
    }

    async function getHome(cb) {
        try {
            const categories = [
                { path: "/serie/", name: "Series", type: "series" },
                { path: "/movies/", name: "Movies", type: "movie" },
                { path: "/category/anime/", name: "Anime", type: "anime" },
                { path: "/category/cartoon/", name: "Cartoon", type: "anime" },
                { path: "/category/crunchyroll/", name: "Crunchyroll", type: "anime" },
                { path: "/category/hindi-dub/", name: "Hindi", type: "anime" },
                { path: "/category/tamil/", name: "Tamil", type: "anime" },
                { path: "/category/telugu/", name: "Telugu", type: "anime" }
            ];

            const result = {};
            for (const cat of categories) {
                try {
                    const res = await http_get(`${manifest.baseUrl}${cat.path}`, headers);
                    const doc = new JSDOM(res.body).window.document;
                    const container = doc.querySelector('.post-lst') || doc.querySelector('.items') || doc.querySelector('.grid-container') || doc.querySelector('#main-content') || doc;
                    const items = Array.from(container.querySelectorAll('article.post')).length > 0 
                        ? Array.from(container.querySelectorAll('article.post')) 
                        : Array.from(container.querySelectorAll('article'));
                    
                    const mappedItems = items.map(el => toMedia(el, cat.type)).filter(Boolean);
                    
                    // Deduplicate items within the same category
                    const seen = new Set();
                    const uniqueItems = mappedItems.filter(item => {
                        if (seen.has(item.url)) return false;
                        seen.add(item.url);
                        return true;
                    });

                    if (uniqueItems.length > 0) result[cat.name] = uniqueItems;
                } catch (e) {
                    console.error(`Error fetching category ${cat.name}:`, e);
                }
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "HTTP_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(`${manifest.baseUrl}/?s=${encodeURIComponent(query)}`, headers);
            const doc = new JSDOM(res.body).window.document;
            const items = Array.from(doc.querySelectorAll('ul[data-results] li article')).map(toMedia).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(urlStr, cb) {
        try {
            const media = safeParse(urlStr);
            if (!media) throw new Error("Invalid URL data");
            const res = await http_get(media.url, headers);
            const doc = new JSDOM(res.body).window.document;

            let title = doc.querySelector('h1.entry-title')?.textContent?.trim()?.replace("Watch Online ", "") || "";
            if (!title) {
                title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.replace("Watch Online ", "")?.split(" Movie")[0] || "No Title";
            }
            const poster = doc.querySelector('div.post-thumbnail figure img')?.getAttribute('src') || media.poster;
            const plot = doc.querySelector('div.entry-content p')?.textContent?.trim() || "";
            const yearText = doc.querySelector('span.year')?.textContent?.trim();
            const year = yearText ? parseInt(yearText) : null;

            const seasonItems = Array.from(doc.querySelectorAll('ul.seasons-lst li'));
            
            if (seasonItems.length === 0) {
                // Movie
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url: JSON.stringify({ url: media.url, mediaType: 1 }),
                        posterUrl: poster,
                        description: plot,
                        type: "movie"
                    })
                });
            } else {
                // Series
                const episodes = seasonItems.map(it => {
                    const name = it.querySelector('h3.title')?.textContent?.trim() || "Episode";
                    const href = it.querySelector('a')?.getAttribute('href');
                    const epPoster = it.querySelector('figure img')?.getAttribute('src');
                    const match = name.match(/S(\d+)/);
                    const season = match ? parseInt(match[1]) : 1;

                    return new Episode({
                        name,
                        url: JSON.stringify({ url: href, mediaType: 2 }),
                        posterUrl: epPoster,
                        season
                    });
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url: urlStr,
                        posterUrl: poster,
                        description: plot,
                        type: "series",
                        episodes: episodes
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(urlInfo, cb) {
        try {
            const media = safeParse(urlInfo);
            if (!media) throw new Error("Invalid URL data");
            const streams = [];

            const mainRes = await http_get(media.url, headers);
            const mainHtml = mainRes.body;
            const doc = new JSDOM(mainHtml).window.document;

            // 1. VidStream / Toronites
            try {
                const res = await http_get(media.url, { "Cookie": "toronites_server=vidstream", ...headers });
                const torDoc = new JSDOM(res.body).window.document;
                const iframes = Array.from(torDoc.querySelectorAll('iframe.serversel[src]'));
                for (const iframe of iframes) {
                    const serverUrl = iframe.getAttribute('src');
                    if (serverUrl) {
                        const innerRes = await http_get(serverUrl, headers);
                        const innerDoc = new JSDOM(innerRes.body).window.document;
                        const finalIframe = innerDoc.querySelector('iframe[src]');
                        if (finalIframe) {
                            await loadExtractor(finalIframe.getAttribute('src'), streams);
                        }
                    }
                }
            } catch (e) {}

            // 2. ID-based Discovery (Try various servers)
            try {
                const bodyClass = doc.body.className;
                let postId = bodyClass.match(/(?:term|postid)-(\d+)/)?.[1];
                if (!postId) postId = mainHtml.match(/postid-(\d+)/)?.[1];

                if (postId) {
                    const encodedId = btoa(postId);
                    const coreServers = ['vidstream', 'gdm', 'stream-v2', 'stream-v3', 'dood', 'file'];
                    for (const srv of coreServers) {
                        try {
                            const pUrl = `${manifest.baseUrl}/player-v1/?id=${encodedId}&server=${srv}`;
                            const pRes = await http_get(pUrl, { ...headers, "Referer": media.url });
                            if (pRes.body && !pRes.body.includes("Page Not Found")) {
                                const pDoc = new JSDOM(pRes.body).window.document;
                                const iframe = pDoc.querySelector('iframe');
                                if (iframe && iframe.getAttribute('src')) {
                                    await loadExtractor(iframe.getAttribute('src'), streams);
                                }
                            }
                        } catch (e) {}
                    }
                    
                    // Legacy trid/trdekho discovery
                    for (let i = 0; i <= 10; i++) {
                        const trUrl = `${manifest.baseUrl}/?trdekho=${i}&trid=${postId}&trtype=${media.mediaType || 0}`;
                        const trRes = await http_get(trUrl, { ...headers, "Referer": media.url });
                        if (trRes.body) {
                            const trDoc = new JSDOM(trRes.body).window.document;
                            const iframe = trDoc.querySelector('iframe');
                            if (iframe && iframe.getAttribute('src')) {
                                await loadExtractor(iframe.getAttribute('src'), streams);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("ID-based Discovery Error:", e);
            }

            // 3. YouTube / Vimeo / Direct Scrape (Alternative Sources)
            try {
                // Broad regex for any embeddable video links in scripts or body
                const videoRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/|player\.vimeo\.com\/video\/|doodstream\.com\/e\/|filemoon\.sx\/e\/|vidmoly\.net\/embed-|emturbovid\.com\/t\/|short\.icu\/)[a-zA-Z0-9_-]+/g;
                const vMatches = mainHtml.match(videoRegex);
                if (vMatches) {
                    for (const vUrl of vMatches) {
                        await loadExtractor(vUrl, streams);
                    }
                }
                
                // Generic Iframe Scrape
                const bodyIframes = Array.from(doc.querySelectorAll('iframe[src]'));
                for (const ifr of bodyIframes) {
                    await loadExtractor(ifr.getAttribute('src'), streams);
                }
            } catch (e) {}

            // Deduplicate by URL
            const seen = new Set();
            const finalStreams = streams.filter(s => {
                if (seen.has(s.url)) return false;
                seen.add(s.url);
                return true;
            });

            cb({ success: true, data: finalStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    async function loadExtractor(url, streams) {
        if (!url) return;
        
        const getDisplayName = (u) => {
            if (u.includes("gdmirrorbot.nl") || u.includes("techinmind.space")) return "GDMirror";
            if (u.includes("awstream.net") || u.includes("as-cdn21.top")) return "AWSStream";
            if (u.includes("rubystm.com")) return "StreamRuby";
            if (u.includes("blakiteapi.xyz")) return "Blakite";
            if (u.includes("youtube.com")) return "YouTube";
            if (u.includes("vimeo.com")) return "Vimeo";
            if (u.includes("dood")) return "DoodStream";
            if (u.includes("filemoon")) return "FileMoon";
            if (u.includes("vidmoly")) return "VidMoly";
            if (u.includes("emturbovid")) return "TurboVid";
            try { return new URL(u).hostname.replace("www.", ""); } catch(e) { return "Server"; }
        };

        const serverName = getDisplayName(url);

        // Router for extractors
        if (url.includes("gdmirrorbot.nl") || url.includes("stream.techinmind.space")) {
            await extractGDMirror(url, streams);
        } else if (url.includes("awstream.net") || url.includes("as-cdn21.top")) {
            await extractAWSStream(url, streams);
        } else if (url.includes("animedekho.app/aaa/") || url.includes("animedekho.co")) {
            await extractAnimedekhoCo(url, streams);
        } else if (url.includes("rubystm.com")) {
            await extractStreamRuby(url, streams);
        } else if (url.includes("blakiteapi.xyz")) {
            await extractBlakite(url, streams);
        } else {
            // Basic fallback for generic extractors
            streams.push(new StreamResult({ url, source: serverName }));
        }
    }

    async function extractGDMirror(url, streams) {
        try {
            const res = await http_get(url, headers);
            let host = url.startsWith("http") ? new URL(url).origin : "";
            if (!host && url.includes("gdmirrorbot.nl")) host = "https://gdmirrorbot.nl";
            if (!host && url.includes("techinmind.space")) host = "https://stream.techinmind.space";
            let sid;

            if (!url.includes("key=")) {
                sid = url.split('/').pop();
            } else {
                const text = res.body;
                const finalId = text.match(/FinalID\s*=\s*"([^"]+)"/)?.[1];
                const myKey = text.match(/myKey\s*=\s*"([^"]+)"/)?.[1];
                if (finalId && myKey) {
                    const apiUrl = url.includes("/tv/") ? 
                        `${host}/myseriesapi?tmdbid=${finalId}&key=${myKey}` :
                        `${host}/mymovieapi?imdbid=${finalId}&key=${myKey}`;
                    const apiRes = await http_get(apiUrl, headers);
                    const json = safeParse(apiRes.body);
                    sid = json?.data?.[0]?.fileslug || url.split('/').pop();
                }
            }

            if (sid) {
                const postRes = await http_post(`${host}/embedhelper.php`, headers, `sid=${sid}`);
                const root = safeParse(postRes.body);
                if (!root) return;
                const mresult = (typeof root.mresult === 'string' && root.mresult.startsWith('{')) ? safeParse(root.mresult) : 
                                (typeof root.mresult === 'string' ? safeParse(atob(root.mresult)) : root.mresult);
                
                if (root.siteUrls && mresult) {
                    for (const key in root.siteUrls) {
                        if (mresult[key]) {
                            const fullUrl = `${root.siteUrls[key].replace(/\/$/, "")}/${mresult[key].replace(/^\//, "")}`;
                            const qual = root.siteFriendlyNames?.[key] || "Auto";
                            streams.push(new StreamResult({ url: fullUrl, source: `GDMirror [${qual}]` }));
                        }
                    }
                }
            }
        } catch (e) { console.error("GDMirror Error:", e); }
    }

    async function extractAWSStream(url, streams) {
        try {
            const hash = url.split('/').pop();
            const host = url.startsWith("http") ? new URL(url).origin : "https://z.awstream.net";
            const apiUrl = `${host}/player/index.php?data=${hash}&do=getVideo`;
            const res = await http_post(apiUrl, { ...headers, "x-requested-with": "XMLHttpRequest" }, `hash=${hash}&r=${encodeURIComponent(url)}`);
            const data = safeParse(res.body);
            if (data && data.videoSource) {
                streams.push(new StreamResult({ url: data.videoSource, source: "AWSStream [1080p]" }));
            }
        } catch (e) { console.error("AWSStream Error:", e); }
    }

    async function extractAnimedekhoCo(url, streams) {
        try {
            const res = await http_get(url, headers);
            const doc = new JSDOM(res.body).window.document;
            const options = Array.from(doc.querySelectorAll('select#serverSelector option'));
            options.forEach(opt => {
                const val = opt.getAttribute('value');
                if (val) streams.push(new StreamResult({ url: val, source: `Server [${opt.textContent.trim()}]` }));
            });
            const fileMatch = res.body.match(/file\s*:\s*"([^"]+)"/);
            if (fileMatch) streams.push(new StreamResult({ url: fileMatch[1], source: "Direct [1080p]" }));
        } catch (e) { console.error("AnimedekhoCo Error:", e); }
    }

    async function extractStreamRuby(url, streams) {
        try {
            const cleaned = url.replace("/e", "");
            const res = await http_get(cleaned, { ...headers, "X-Requested-With": "XMLHttpRequest" });
            const fileMatch = res.body.match(/file:\"(.*)\"/);
            if (fileMatch) streams.push(new StreamResult({ url: fileMatch[1], source: "StreamRuby [1080p]" }));
        } catch (e) { console.error("StreamRuby Error:", e); }
    }

    async function extractBlakite(url, streams) {
        try {
            const id = url.split('/').pop();
            const tmdbId = url.match(/embed\/([^\/]+)/)?.[1];
            const apiUrl = `https://blakiteapi.xyz/api/get.php?id=${id}&tmdbId=${tmdbId}`;
            const res = await http_get(apiUrl, headers);
            const json = JSON.parse(res.body);
            if (json.success) {
                const streamUrl = `https://blakiteapi.xyz/stream/${json.data.dataId}.${json.data.format}`;
                const qual = json.data.quality || "Auto";
                streams.push(new StreamResult({ url: streamUrl, source: `Blakite [${qual}]` }));
            }
        } catch (e) { console.error("Blakite Error:", e); }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
