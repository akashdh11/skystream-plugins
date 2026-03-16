(function() {
    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" };

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === 'object') return data;
        try { return JSON.parse(data); } catch (e) { return null; }
    }

    async function toMedia(element, type = "series") {
        const lnk = element.querySelector('a');
        if (!lnk) return null;
        const href = lnk.getAttribute('href') || "";
        const title = (await element.querySelector('header h2'))?.textContent?.trim() || "Untitled";
        const img = await element.querySelector('img');
        let poster = img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || img?.getAttribute('src');
        if (poster?.startsWith('data:image')) {
             poster = img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src');
        }
        
        if (poster && !poster.startsWith('http')) {
            poster = (poster.startsWith('//') ? 'https:' : '') + poster;
        }

        let detectedType = type;
        if (href.includes("/movies/")) {
            detectedType = "movie";
        } else if (href.includes("/series/") || href.includes("/series/")) {
            detectedType = "series";
        }

        return new MultimediaItem({
            title: title,
            url: JSON.stringify({ url: href, poster: poster }),
            posterUrl: poster,
            type: detectedType
        });
    }

    async function getHome(cb) {
        try {
            const categories = [
                { path: "category/status/ongoing", name: "On-Air Shows", type: "series" },
                { path: "category/type/anime/?type=series", name: "New Anime Arrivals", type: "series" },
                { path: "category/type/cartoon/?type=series", name: "Just In: Cartoon Series", type: "series" },
                { path: "category/type/anime/?type=movies", name: "Latest Anime Movies", type: "movie" },
                { path: "category/type/cartoon/?type=movies", name: "Fresh Cartoon Films", type: "movie" },
                { path: "category/network/crunchyroll", name: "Crunchyroll", type: "series" },
                { path: "category/network/netflix", name: "Netflix", type: "series" },
                { path: "category/network/prime-video", name: "Prime Video", type: "series" }
            ];

            const result = {};
            for (const cat of categories) {
                try {
                    let url = `${manifest.baseUrl}/${cat.path}`;
                    if (url.includes("/?type=")) {
                         const parts = url.split("/?type=");
                         url = `${parts[0]}/page/1/?type=${parts[1]}`;
                    } else {
                         url = `${url}/page/1`;
                    }

                    const res = await http_get(url, headers);
                    const doc = await parseHtml(res.body);
                    const articles = await doc.querySelectorAll('article');
                    const items = (await Promise.all(articles.map(el => toMedia(el, cat.type)))).filter(Boolean);
                    if (items.length > 0) result[cat.name] = items;
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
            const formData = `action=torofilm_infinite_scroll&page=1&per_page=12&query_type=search&query_args[s]=${encodeURIComponent(query)}`;
            const res = await http_post(`${manifest.baseUrl}/wp-admin/admin-ajax.php`, { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, formData);
            const data = safeParse(res.body);
            if (data && data.success && data.data && data.data.content) {
                const doc = await parseHtml(data.data.content);
                const articles = await doc.querySelectorAll('article');
                const items = (await Promise.all(articles.map(el => toMedia(el)))).filter(Boolean);
                cb({ success: true, data: items });
            } else {
                cb({ success: true, data: [] });
            }
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(urlStr, cb) {
        try {
            const media = safeParse(urlStr);
            if (!media) throw new Error("Invalid URL data");
            const res = await http_get(media.url, headers);
            const doc = await parseHtml(res.body);

            const title = (await doc.querySelector('h1'))?.textContent?.trim() || "No Title";
            const img = await doc.querySelector('div.bd > div:nth-child(1) > img');
            let poster = img?.getAttribute('src') || img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || media.poster;
            if (poster?.startsWith('data:image')) {
                 poster = img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || media.poster;
            }
            if (poster && !poster.startsWith('http')) {
                poster = (poster.startsWith('//') ? 'https:' : '') + poster;
            }
            const plot = (await doc.querySelector('#overview-text p'))?.textContent?.trim() || "";
            const divs = await doc.querySelectorAll('div');
            const yearText = Array.from(divs).find(el => el.textContent.trim().match(/^\d{4}$/))?.textContent?.trim();
            const year = yearText ? parseInt(yearText) : null;
            
            const tvType = media.url.includes("movies") ? "movie" : "series";

            const sections = ["Genres", "Languages"];
            let tags = [];
            const headers4 = await doc.querySelectorAll('h4');
            for (const label of sections) {
                const h4 = Array.from(headers4).find(el => el.textContent.includes(label));
                if (h4 && h4.nextElementSibling) {
                    const links = await h4.nextElementSibling.querySelectorAll('a');
                    tags = tags.concat(Array.from(links).map(a => a.textContent.trim()));
                }
            }

            if (tvType === "series") {
                const episodes = [];
                const seasonButtons = await doc.querySelectorAll('div.season-buttons a, .toro-season-button');
                
                for (const btn of seasonButtons) {
                    const postId = btn.getAttribute('data-post');
                    const dataSeason = btn.getAttribute('data-season') || btn.getAttribute('data-num');
                    const seasonNum = parseInt(dataSeason) || 1;

                    const formData = `action=action_select_season&season=${dataSeason}&post=${postId}`;
                    const res = await http_post(`${manifest.baseUrl}/wp-admin/admin-ajax.php`, { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, formData);
                    const epDoc = await parseHtml(res.body);

                    const articles = await epDoc.querySelectorAll('li article');
                    for (const [index, ep] of Array.from(articles).entries()) {
                        const href = (await ep.querySelector('a'))?.getAttribute('href');
                        const epImg = await ep.querySelector('div.post-thumbnail img');
                        let image = epImg?.getAttribute('src') || epImg?.getAttribute('data-src');
                        if (image?.startsWith('data:image')) image = epImg?.getAttribute('data-src');
                        const name = ep.querySelector('h2.entry-title')?.textContent?.trim() || `Episode ${index + 1}`;
                        
                        episodes.push(new Episode({
                            name,
                            url: JSON.stringify({ url: href, mediaType: 2 }),
                            posterUrl: image,
                            season: seasonNum,
                            episode: index + 1
                        }));
                    }
                }

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url: urlStr,
                        posterUrl: poster,
                        description: plot,
                        type: "series",
                        year,
                        tags,
                        episodes: episodes
                    })
                });
            } else {
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url: urlStr,
                        posterUrl: poster,
                        description: plot,
                        type: "movie",
                        year,
                        tags,
                        episodes: [
                             new Episode({
                                 name: title,
                                 url: urlStr,
                                 posterUrl: poster
                             })
                        ]
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

            const res = await http_get(media.url, headers);
            const doc = await parseHtml(res.body);
            const iframes = await doc.querySelectorAll('#options-0 iframe');

            for (const iframe of iframes) {
                let src = iframe.getAttribute('data-src');
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    await loadExtractor(src, streams);
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    async function loadExtractor(url, streams) {
        if (!url) return;
        let host = "";
        try { host = new URL(url).hostname; } catch(e) {}
        
        if (url.includes("z.awstream.net") || url.includes("as-cdn21.top") || url.includes("play.zephyrflick.top") || url.includes("beta.awstream.net")) {
            await extractAWSStream(url, streams);
        } else if (url.includes("megaplay.buzz") || url.includes("rapid-cloud.co")) {
            await extractMegaPlay(url, streams);
        } else if (url.includes("ghbrisk.com") || url.includes("streamwish") || url.includes("filelions") || url.includes("pixdrive") || url.includes("vidmoly")) {
            const name = url.includes("pixdrive") ? "Pixdrive" : (url.includes("vidmoly") ? "VidMoly" : "Streamwish");
            await extractFilesim(url, streams, name);
        } else {
            // Basic fallback
            const name = host.replace("www.", "") || "Server";
            streams.push(new StreamResult({ 
                url: url, 
                source: name,
                headers: {
                    "Referer": manifest.baseUrl + "/"
                }
            }));
        }
    }

    async function extractAWSStream(url, streams) {
        try {
            const extractedHash = url.split('/').pop();
            const urlObj = new URL(url);
            const baseUrl = urlObj.origin;
            const apiUrl = `${baseUrl}/player/index.php?data=${extractedHash}&do=getVideo`;
            const postData = `hash=${extractedHash}&r=${encodeURIComponent(baseUrl)}`;
            
            const res = await http_post(apiUrl, { 
                ...headers, 
                "x-requested-with": "XMLHttpRequest", 
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": url
            }, postData);
            const data = safeParse(res.body);
            
            if (data && data.videoSource) {
                streams.push(new StreamResult({
                    url: data.videoSource,
                    source: `AWSStream [1080p]`,
                    headers: {
                        "Referer": "",
                        "User-Agent": headers["User-Agent"]
                    }
                }));
            }
        } catch (e) { console.error("AWSStream Error:", e); }
    }

    async function extractMegaPlay(url, streams) {
        try {
            const urlObj = new URL(url);
            const baseUrl = urlObj.origin;
            const res = await http_get(url, headers);
            const doc = await parseHtml(res.body);
            const id = (await doc.querySelector('#megaplay-player'))?.getAttribute('data-id');

            if (id) {
                const apiUrl = `${baseUrl}/stream/getSources?id=${id}&id=${id}`;
                const apiRes = await http_get(apiUrl, { ...headers, "X-Requested-With": "XMLHttpRequest", "Referer": url });
                const data = safeParse(apiRes);
                if (data && data.sources && data.sources.file) {
                    streams.push(new StreamResult({
                        url: data.sources.file,
                        source: `MegaPlay [1080p]`,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
                            "Accept": "*/*",
                            "Accept-Language": "en-US,en;q=0.5",
                            "Accept-Encoding": "gzip, deflate, br, zstd",
                            "Origin": "https://rapid-cloud.co",
                            "Referer": "https://rapid-cloud.co/",
                            "Connection": "keep-alive",
                            "Pragma": "no-cache",
                            "Cache-Control": "no-cache"
                        }
                    }));
                }
            }
        } catch (e) { console.error("MegaPlay Error:", e); }
    }

    async function extractFilesim(url, streams, serverName) {
        try {
            const res = await http_get(url, headers);
            // Look for sources in the body or packed script
            let content = res.body;
            const sourceMatch = content.match(/sources:[\s\t]*\[([^\]]+)\]/);
            if (sourceMatch) {
                const fileMatch = sourceMatch[1].match(/file:[\s\t]*["']([^"']+)["']/);
                if (fileMatch) {
                    streams.push(new StreamResult({
                        url: fileMatch[1],
                        source: `${serverName} [720p]`,
                        headers: {
                            "Referer": url,
                            "User-Agent": headers["User-Agent"]
                        }
                    }));
                }
            }
        } catch (e) { console.error(`${serverName} Error:`, e); }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
