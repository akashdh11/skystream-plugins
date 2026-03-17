(function() {
    /**
     * Bollyflix Plugin for SkyStream
     * Ported from Kotlin Cloudstream extension
     */

    const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
    const DEFAULT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    };

    function getBaseUrl() {
        return manifest?.baseUrl || "https://bollyflix.sarl";
    }

    async function bypass(id) {
        try {
            const url = `https://web.sidexfee.com/?id=${id}`;
            const res = await http_get(url);
            const match = res.body.match(/link":"([^"]+)"/);
            if (match) {
                let encoded = match[1].replace(/\\\//g, "/");
                // Ensure padding for atob if needed
                while (encoded.length % 4 !== 0) encoded += '=';
                return atob(encoded);
            }
        } catch (e) {
            console.error("Bypass Error:", e);
        }
        return "";
    }

    function toSearchResult(el) {
        const a = el.querySelector('a');
        if (!a) return null;
        
        const title = a.getAttribute('title')?.replace("Download ", "") || "No Title";
        const href = a.getAttribute('href');
        const img = el.querySelector('img');
        const posterUrl = img?.getAttribute('src') || "";

        return new MultimediaItem({
            title: title,
            url: href,
            posterUrl: posterUrl,
            type: "movie" // Default, will refine in load()
        });
    }

    async function getHome(cb) {
        try {
            const sections = [
                { name: "Home", path: "/" },
                { name: "Bollywood Movies", path: "/movies/bollywood/" },
                { name: "Hollywood Movies", path: "/movies/hollywood/" },
                { name: "Anime", path: "/anime/" }
            ];

            const homeData = {};
            for (const section of sections) {
                const url = `${getBaseUrl()}${section.path}`;
                const res = await http_get(url);
                const doc = await parseHtml(res.body);
                const items = Array.from(doc.querySelectorAll('div.post-cards > article'))
                    .map(toSearchResult)
                    .filter(Boolean);
                
                if (items.length > 0) {
                    homeData[section.name] = items;
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const url = `${getBaseUrl()}/search/${encodeURIComponent(query)}/page/1/`;
            const res = await http_get(url);
            const doc = await parseHtml(res.body);
            const items = Array.from(doc.querySelectorAll('div.post-cards > article'))
                .map(toSearchResult)
                .filter(Boolean);
            
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url);
            const doc = await parseHtml(res.body);
            
            let title = doc.querySelector('title')?.textContent?.replace("Download ", "")?.trim() || "No Title";
            let posterUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || "";
            let description = doc.querySelector('span#summary')?.textContent?.trim() || "";
            
            const isSeries = title.toLowerCase().includes("series") || url.includes("web-series");
            const tvType = isSeries ? "series" : "movie";
            
            const imdbAnchor = doc.querySelector('div.imdb_left > a');
            const imdbUrl = imdbAnchor?.getAttribute('href');
            
            let metadata = null;
            if (imdbUrl) {
                const imdbId = imdbUrl.split('title/')[1]?.split('/')[0];
                if (imdbId) {
                    try {
                        const metaRes = await http_get(`${CINEMETA_URL}/${tvType}/${imdbId}.json`);
                        const metaJson = JSON.parse(metaRes.body);
                        if (metaJson.meta) {
                            metadata = metaJson.meta;
                        }
                    } catch (e) {
                        console.error("Cinemeta Error:", e);
                    }
                }
            }

            const item = new MultimediaItem({
                title: metadata?.name || title,
                url: url,
                posterUrl: metadata?.poster || posterUrl,
                bannerUrl: metadata?.background || posterUrl,
                description: metadata?.description || description,
                type: tvType,
                year: metadata?.year ? parseInt(metadata.year) : null,
                score: metadata?.imdbRating ? parseFloat(metadata.imdbRating) / 10 : null,
                genres: metadata?.genre || [],
                cast: (metadata?.cast || []).map(name => new Actor({ name: name }))
            });

            if (isSeries) {
                const episodes = [];
                const buttons = Array.from(doc.querySelectorAll('a.maxbutton-download-links, a.dl, a.btnn'));
                
                for (const btn of buttons) {
                    let link = btn.getAttribute('href');
                    if (link.includes('id=')) {
                        const id = link.split('id=')[1];
                        link = await bypass(id);
                    }
                    
                    const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
                    const sMatch = seasonText.match(/(?:Season |S)(\d+)/i);
                    const seasonNum = sMatch ? parseInt(sMatch[1]) : 1;
                    
                    try {
                        const sRes = await http_get(link);
                        const sDoc = await parseHtml(sRes.body);
                        const epLinks = Array.from(sDoc.querySelectorAll('h3 > a'))
                            .filter(a => !a.textContent.toLowerCase().includes("zip"));
                            
                        epLinks.forEach((a, idx) => {
                            episodes.push(new Episode({
                                name: a.textContent.trim() || `Episode ${idx + 1}`,
                                url: a.getAttribute('href'),
                                season: seasonNum,
                                episode: idx + 1
                            }));
                        });
                    } catch (e) {
                        console.error("Season Load Error:", e);
                    }
                }
                if (metadata?.videos) {
                    const epMap = {};
                    metadata.videos.forEach(v => {
                        epMap[`${v.season}-${v.episode}`] = {
                            thumbnail: v.thumbnail,
                            name: v.name || v.title,
                            description: v.overview
                        };
                    });
                    
                    episodes.forEach(ep => {
                        const info = epMap[`${ep.season}-${ep.episode}`];
                        if (info) {
                            ep.posterUrl = info.thumbnail;
                            ep.name = info.name || ep.name;
                            ep.description = info.description || ep.description;
                        }
                    });
                }
                item.episodes = episodes;
            } else {
                const dlButtons = Array.from(doc.querySelectorAll('a.dl'));
                const movieLinks = [];
                for (const btn of dlButtons) {
                    let link = btn.getAttribute('href');
                    if (link.includes('id=')) {
                        const id = link.split('id=')[1];
                        link = await bypass(id);
                    }
                    const text = btn.textContent;
                    const quality = extractQuality(text) || extractQuality(title);
                    movieLinks.push({ url: link, quality: quality });
                }
                
                item.episodes = [new Episode({
                    name: "Play Movie",
                    url: JSON.stringify(movieLinks), // Store objects for loadStreams
                    season: 1,
                    episode: 1
                })];
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    function extractQuality(text) {
        if (!text) return "";
        const qualities = ["480p", "720p", "1080p", "2160p", "4k"];
        for (const q of qualities) {
            if (text.toLowerCase().includes(q)) return q;
        }
        return "";
    }

    async function loadStreams(url, cb) {
        try {
            const streams = [];
            let urlsToProcess = [];
            
            try {
                const parsed = JSON.parse(url);
                if (Array.isArray(parsed)) {
                    urlsToProcess = parsed;
                } else {
                    urlsToProcess = [url];
                }
            } catch (e) {
                urlsToProcess = [url];
            }

            for (const sItem of urlsToProcess) {
                const streamUrl = typeof sItem === 'string' ? sItem : sItem.url;
                const sQuality = typeof sItem === 'object' ? sItem.quality : "";
                const sSuffix = sQuality ? ` [${sQuality}]` : "";

                if (streamUrl.includes("gdflix") || streamUrl.includes("gdlink") || streamUrl.includes("fastdlserver")) {
                    await extractGDFlix(streamUrl, streams);
                } else {
                    // Regular extractors
                    streams.push(new StreamResult({
                        url: streamUrl,
                        source: `Direct${sSuffix}`,
                        headers: DEFAULT_HEADERS
                    }));
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function extractGDFlix(url, streams) {
        try {
            const res = await http_get(url);
            const doc = await parseHtml(res.body);
            
            const fileName = doc.querySelector('ul > li.list-group-item:contains(Name)')?.textContent?.split('Name : ')[1] || "Video";
            const fileSize = doc.querySelector('ul > li.list-group-item:contains(Size)')?.textContent?.split('Size : ')[1] || "";
            
            const anchors = Array.from(doc.querySelectorAll('div.text-center a'));
            for (const a of anchors) {
                const text = a.textContent;
                const href = a.getAttribute('href');
                if (!href) continue;

                const quality = extractQuality(fileName);
                const sourceSuffix = quality ? ` [${quality}]` : "";

                if (text.includes("DIRECT") || text.includes("FSL V2") || text.includes("CLOUD")) {
                    sourceName = text.trim();
                    streams.push(new StreamResult({
                        url: href,
                        source: `${sourceName}${sourceSuffix} (${fileSize})`,
                        headers: DEFAULT_HEADERS
                    }));
                } else if (text.includes("FAST CLOUD")) {
                    try {
                        const sUrl = (url.startsWith('http') ? new URL(url).origin : "") + href;
                        const sRes = await http_get(sUrl);
                        const sDoc = await parseHtml(sRes.body);
                        const dlink = sDoc.querySelector('div.card-body a')?.getAttribute('href');
                        if (dlink) {
                            streams.push(new StreamResult({
                                url: dlink,
                                source: "FastCloud",
                                headers: DEFAULT_HEADERS
                            }));
                        }
                    } catch (e) {}
                } else if (href.includes("pixeldrain")) {
                    const id = href.split('/').pop();
                    streams.push(new StreamResult({
                        url: `https://pixeldrain.com/api/file/${id}?download`,
                        source: `Pixeldrain${sourceSuffix} (${fileSize})`,
                        headers: DEFAULT_HEADERS
                    }));
                }
            }
        } catch (e) {
            console.error("GDFlix Extraction Error:", e);
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
