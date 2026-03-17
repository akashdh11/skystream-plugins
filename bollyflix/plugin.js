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

    function checkIsSeries(title, url) {
        const t = (title || "").toLowerCase();
        const u = (url || "").toLowerCase();
        return t.includes("series") ||
               u.includes("/series/") ||
               u.includes("-season-") ||
               u.includes("-series-");
    }

    function toSearchResult(el) {
        const a = el.querySelector('a');
        if (!a) return null;
        
        const title = a.getAttribute('title')?.replace("Download ", "") || "No Title";
        const href = a.getAttribute('href');
        const img = el.querySelector('img');
        const posterUrl = img?.getAttribute('src') || "";

        const isSeries = checkIsSeries(title, href);
        // console.log(`[Bollyflix] Home/Search detection: ${title} -> ${isSeries ? 'tvseries' : 'movie'}`);

        return  new MultimediaItem({
            title: title,
            url: href,
            posterUrl: posterUrl,
            type: isSeries ? "tvseries" : "movie",
            contentType: isSeries ? "tvseries" : "movie"
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
            
            const isSeries = checkIsSeries(title, url);
            const tvType = isSeries ? "tvseries" : "movie";
            console.log(`[Bollyflix] load detection: ${title} -> ${tvType}`);
            
            const imdbAnchor = doc.querySelector('div.imdb_left > a');
            const imdbUrl = imdbAnchor?.getAttribute('href');
            
            let metadata = null;
            if (imdbUrl) {
                const imdbId = imdbUrl.split('title/')[1]?.split('/')[0];
                if (imdbId) {
                    try {
                        const metaRes = await http_get(`${CINEMETA_URL}/${isSeries ? 'series' : 'movie'}/${imdbId}.json`);
                        const metaJson = JSON.parse(metaRes.body);
                        if (metaJson.meta) {
                            metadata = metaJson.meta;
                        }
                    } catch (e) {
                        console.error("Cinemeta Error:", e);
                    }
                }
            }

            // Fallback values to prevent ReferenceErrors
            const fallbackYear = metadata?.year ? parseInt(metadata.year) : 0;
            const fallbackScore = metadata?.imdbRating ? parseFloat(metadata.imdbRating) : 0;
            const fallbackGenres = metadata?.genre || [];
            const fallbackCast = (metadata?.cast || []).map(name => ({ name: name }));

            const item = {
                title: metadata?.name || title,
                url: url,
                posterUrl: metadata?.poster || posterUrl,
                bannerUrl: metadata?.background || posterUrl,
                description: metadata?.description || description,
                type: tvType,
                contentType: tvType,
                year: fallbackYear,
                score: fallbackScore,
                genres: fallbackGenres,
                cast: fallbackCast,
                episodes: []
            };

            if (isSeries) {
                console.log("[Bollyflix] Parsing series episodes...");
                const episodesMap = {};
                // Deep scan of entry-content to handle nested containers
                const content = doc.querySelector('.entry-content');
                if (!content) throw new Error("Could not find .entry-content container");
                
                // Find all potential headers and buttons in document order using simple selector for Dart HTML compatibility
                const allElements = Array.from(content.querySelectorAll('*')).filter(el => {
                    const tag = el.tagName ? el.tagName.toUpperCase() : '';
                    return ['H1', 'H2', 'H3', 'H4', 'H5', 'P', 'A'].includes(tag);
                });
                
                let currentSeasonNum = 1;
                const buttonTasks = [];

                const checkSeasonText = (txt) => {
                    const sMatch = (txt || "").match(/(?:Season |S)(\d+)/i);
                    return sMatch ? parseInt(sMatch[1]) : null;
                };

                allElements.forEach((el) => {
                    const tag = el.tagName || "";
                    const c = el.className || "";
                    const txt = el.textContent || "";
                    
                    const sNum = checkSeasonText(txt);
                    if (sNum && tag.toUpperCase().startsWith('H')) {
                        currentSeasonNum = sNum;
                    }

                    // Check if the element is a button
                    if (tag.toUpperCase() === 'A' && (c.includes('maxbutton') || c.includes('dl') || c.includes('btnn'))) {
                        const btnText = txt.toLowerCase();
                        
                        if (btnText.includes('download') || btnText.includes('links') || btnText.includes('view') || btnText.includes('click')) {
                            const seasonAtPoint = checkSeasonText(txt) || currentSeasonNum;
                            let link = el.getAttribute('href');
                            
                            if (link && link.startsWith('http')) {
                                buttonTasks.push((async (sNum, bUrl, bText) => {
                                    try {
                                        if (bUrl.includes('id=')) {
                                            const id = bUrl.split('id=')[1];
                                            bUrl = await bypass(id);
                                        }
                                        
                                        const sRes = await http_get(bUrl);
                                        const sDoc = await parseHtml(sRes.body);
                                        const epLinks = Array.from(sDoc.querySelectorAll('a'))
                                            .filter(a => {
                                                const text = a.textContent.toLowerCase();
                                                const href = a.getAttribute('href') || "";
                                                return !text.includes("zip") && !text.includes("elinks") && href.startsWith('http');
                                            });
                                            
                                        const quality = extractQuality(bText) || extractQuality(el.parentElement?.textContent || "");
                                
                                epLinks.forEach((a, idx) => {
                                    const epText = a.textContent.trim();
                                    const epMatch = epText.match(/(?:Episode |E|Ep |Ep)(\d+)/i);
                                    const epNum = epMatch ? parseInt(epMatch[1]) : (idx + 1);
                                    
                                    const key = `${sNum}-${epNum}`;
                                    if (!episodesMap[key]) {
                                        episodesMap[key] = {
                                            name: epText || `Episode ${epNum}`,
                                            urls: [],
                                            season: sNum,
                                            episode: epNum
                                        };
                                    }
                                    const href = a.getAttribute('href');
                                    if (!episodesMap[key].urls.some(u => u.url === href)) {
                                        episodesMap[key].urls.push({
                                            url: href,
                                            quality: quality
                                        });
                                    }
                                });
                                    } catch (e) {
                                        console.error("Button processing error:", e);
                                    }
                                })(seasonAtPoint, link, el.textContent));
                            }
                        }
                    }
                });

                await Promise.all(buttonTasks);

                const episodes = Object.values(episodesMap).map(ep => ({
                    name: ep.name,
                    url: JSON.stringify(ep.urls),
                    season: ep.season,
                    episode: ep.episode
                }));

                // Sort episodes by season and then episode number
                episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

                if (metadata?.videos) {
                    const thumbMap = {};
                    metadata.videos.forEach(v => {
                        thumbMap[`${v.season}-${v.episode}`] = {
                            thumbnail: v.thumbnail,
                            name: v.name || v.title,
                            description: v.overview
                        };
                    });
                    
                    episodes.forEach(ep => {
                        const info = thumbMap[`${ep.season}-${ep.episode}`];
                        if (info) {
                            ep.posterUrl = info.thumbnail;
                            ep.name = info.name || ep.name;
                            ep.description = info.description || ep.description;
                        }
                    });
                }
                item.episodes = episodes;
                console.log(`[Bollyflix] total episodes parsed: ${episodes.length}`);
            } else {
                const dlButtons = Array.from(doc.querySelectorAll('a.dl, a.maxbutton-download-links, a.maxbutton-download-link'));
                console.log(`[Bollyflix] movie buttons found: ${dlButtons.length}`);
                const movieLinks = [];
                for (const btn of dlButtons) {
                    let link = btn.getAttribute('href');
                    if (!link) continue;
                    if (link.includes('id=')) {
                        const id = link.split('id=')[1];
                        link = await bypass(id);
                    }
                    const text = btn.textContent;
                    const quality = extractQuality(text) || extractQuality(title);
                    movieLinks.push({ url: link, quality: quality });
                }
                
                item.episodes = [{
                    name: "Play Movie",
                    url: JSON.stringify(movieLinks),
                    season: 1,
                    episode: 1
                }];
                console.log(`[Bollyflix] movie links populated: ${movieLinks.length}`);
            }

            console.log(`[Bollyflix] Load SUCCESS: ${item.title} (${item.type}) with ${item.episodes.length} episodes`);
            cb({ success: true, data: item });
        } catch (e) {
            console.error("Load Error:", e);
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
                const qualitySuffix = quality ? ` [${quality}]` : "";

                if (text.includes("DIRECT") || text.includes("FSL V2") || text.includes("CLOUD")) {
                    const sourceName = text.trim();
                    streams.push(new StreamResult({
                        url: href,
                        source: `${sourceName}${qualitySuffix} (${fileSize})`,
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
                                source: `FastCloud${qualitySuffix}`,
                                headers: DEFAULT_HEADERS
                            }));
                        }
                    } catch (e) {}
                } else if (href.includes("pixeldrain")) {
                    const id = href.split('/').pop();
                    streams.push(new StreamResult({
                        url: `https://pixeldrain.com/api/file/${id}?download`,
                        source: `Pixeldrain${qualitySuffix} (${fileSize})`,
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
