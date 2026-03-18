(function() {
    const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
    const TMDB_BASE_URL = "https://api.themoviedb.org/3";
    const MAIN_URL = "https://new3.hdhub4u.fo";
    
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        "Cookie": "xla=s4t",
        "Referer": `${MAIN_URL}/`
    };

    function cleanTitle(title) {
        let name = (title || "").replace(/\.[a-zA-Z0-9]{2,4}$/, "");
        const normalized = name.replace(/WEB[-_. ]?DL/gi, "WEB-DL").replace(/WEB[-_. ]?RIP/gi, "WEBRIP").replace(/H[ .]?265/gi, "H265").replace(/H[ .]?264/gi, "H264").replace(/DDP[ .]?([0-9]\.[0-9])/gi, "DDP$1");
        const parts = normalized.split(/[\s_.]/);
        const sourceTags = new Set(["WEB-DL", "WEBRIP", "BLURAY", "HDRIP", "DVDRIP", "HDTV", "CAM", "TS", "BRRIP", "BDRIP"]);
        const codecTags = new Set(["H264", "H265", "X264", "X265", "HEVC", "AVC"]);
        const audioTags = ["AAC", "AC3", "DTS", "MP3", "FLAC", "DD", "DDP", "EAC3"];
        const audioExtras = new Set(["ATMOS"]);
        const hdrTags = new Set(["SDR", "HDR", "HDR10", "HDR10+", "DV", "DOLBYVISION"]);
        
        const filtered = parts.map((part) => {
            const p = part.toUpperCase();
            if (sourceTags.has(p)) return p;
            if (codecTags.has(p)) return p;
            if (audioTags.some((tag) => p.startsWith(tag))) return p;
            if (audioExtras.has(p)) return p;
            if (hdrTags.has(p)) return p === "DOLBYVISION" || p === "DV" ? "DOLBYVISION" : p;
            if (p === "NF" || p === "CR") return p;
            return null;
        }).filter(Boolean);
        
        return [...new Set(filtered)].join(" ");
    }

    async function search(query, cb) {
        try {
            const today = (new Date()).toISOString().split("T")[0];
            const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=${encodeURIComponent(query)}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;
            
            const response = await http_get(searchUrl, { headers: HEADERS });
            const data = JSON.parse(response.body);
            
            if (!data || !data.hits) {
                return cb({ success: true, data: [] });
            }

            const results = data.hits.map((hit) => {
                const doc = hit.document;
                const title = doc.post_title;
                const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
                const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
                let url = doc.permalink;
                if (url && url.startsWith("/")) {
                    url = `${MAIN_URL}${url}`;
                }
                
                const categories = Array.isArray(doc.category) ? doc.category.join(" ") : (doc.category || "");
                const isMovie = categories.toLowerCase().includes("movie");

                return new MultimediaItem({
                    title: title.replace(/\|.*$/, "").trim(),
                    url: url,
                    posterUrl: doc.post_thumbnail,
                    year: year,
                    type: isMovie ? "movie" : "series",
                    contentType: isMovie ? "movie" : "series"
                });
            });

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    async function getHome(cb) {
        try {
            const sections = [
                { name: "Latest", path: "" },
                { name: "Bollywood", path: "/category/bollywood-movies/" },
                { name: "Hollywood", path: "/category/hollywood-movies/" },
                { name: "Hindi Dubbed", path: "/category/hindi-dubbed/" },
                { name: "South Hindi", path: "/category/south-hindi-movies/" },
                { name: "Web Series", path: "/category/category/web-series/" },
                { name: "Adult", path: "/category/adult/" }
            ];

            const homeData = {};
            for (const section of sections) {
                try {
                    const url = section.path ? `${MAIN_URL}${section.path}` : MAIN_URL;
                    const res = await http_get(url, { headers: HEADERS });
                    const doc = await parseHtml(res.body);
                    
                    const items = Array.from(doc.querySelectorAll('.recent-movies > li.thumb')).map(el => {
                        const a = el.querySelector('figcaption a');
                        if (!a) return null;
                        const titleText = a.textContent.trim();
                        const href = el.querySelector('figure a')?.getAttribute('href');
                        const poster = el.querySelector('figure img')?.getAttribute('src');
                        
                        const isSeries = href?.includes("/series/") || titleText.toLowerCase().includes("season") || titleText.toLowerCase().includes("web series");
                        
                        return new MultimediaItem({
                            title: titleText.replace(/\|.*$/, "").trim(),
                            url: href,
                            posterUrl: poster,
                            type: isSeries ? "series" : "movie",
                            contentType: isSeries ? "series" : "movie"
                        });
                    }).filter(Boolean);
                    
                    homeData[section.name] = items;
                } catch (err) {
                    console.error(`Error loading section ${section.name}:`, err);
                    homeData[section.name] = [];
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    async function getTMDBDetails(tmdbId, mediaType) {
        const endpoint = mediaType === "tv" ? "tv" : "movie";
        const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids,credits`;
        const response = await http_get(url, { headers: { "Accept": "application/json" } });
        const data = JSON.parse(response.body);
        
        const actors = (data.credits?.cast || []).slice(0, 15).map(c => new Actor({
            name: c.name,
            image: c.profile_path ? `https://image.tmdb.org/t/p/w500${c.profile_path}` : null,
            role: c.character
        }));

        return {
            title: mediaType === "tv" ? data.name : data.title,
            year: (mediaType === "tv" ? data.first_air_date : data.release_date)?.split("-")[0],
            description: data.overview,
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            rating: data.vote_average,
            imdbId: data.external_ids?.imdb_id,
            cast: actors
        };
    }

    async function getTMDBSeasonEpisodes(tmdbId, seasonNumber) {
        try {
            const url = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
            const response = await http_get(url, { headers: { "Accept": "application/json" } });
            const data = JSON.parse(response.body);
            return (data.episodes || []).reduce((acc, ep) => {
                acc[ep.episode_number] = {
                    name: ep.name,
                    description: ep.overview,
                    posterUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null
                };
                return acc;
            }, {});
        } catch (e) {
            return {};
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, { headers: HEADERS });
            const doc = await parseHtml(res.body);
            
            const rawTitle = doc.querySelector('.page-title span')?.textContent?.trim() || "Unknown Title";
            const description = doc.querySelector('.recent-movies p')?.textContent?.trim() || "";
            const poster = doc.querySelector('main.page-body img.aligncenter')?.getAttribute('src');
            
            const typeraw = doc.querySelector('h1.page-title span')?.textContent || "";
            const isMovie = typeraw.toLowerCase().includes("movie");
            
            const seasonMatch = rawTitle.match(/(?:Season|S)\s*(\d+)/i);
            const seasonNumber = seasonMatch ? parseInt(seasonMatch[1]) : 1;

            // Metadata Enrichment
            let tmdbData = null;
            let tmdbSeasonEpisodes = {};
            const imdbLink = doc.querySelector('a[href*="imdb.com"]')?.getAttribute('href');
            const tmdbLink = doc.querySelector('a[href*="themoviedb.org"]')?.getAttribute('href');
            
            let tmdbId = null;
            if (tmdbLink) {
                tmdbId = tmdbLink.split('/')[4]?.split('-')[0];
            } else if (imdbLink) {
                const imdbId = imdbLink.split('/title/')[1]?.split('/')[0];
                if (imdbId) {
                    const findUrl = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
                    const findRes = await http_get(findUrl, { headers: { "Accept": "application/json" } });
                    const findData = JSON.parse(findRes.body);
                    tmdbId = isMovie ? findData.movie_results?.[0]?.id : findData.tv_results?.[0]?.id;
                }
            }

            if (tmdbId) {
                tmdbData = await getTMDBDetails(tmdbId, isMovie ? "movie" : "tv");
                if (!isMovie) {
                    tmdbSeasonEpisodes = await getTMDBSeasonEpisodes(tmdbId, seasonNumber);
                }
            }

            let finalTitle = tmdbData?.title || rawTitle.replace(/\|.*$/, "").trim();
            if (!isMovie && seasonNumber && !finalTitle.toLowerCase().includes(`season ${seasonNumber}`)) {
                finalTitle = `${finalTitle} (Season ${seasonNumber})`;
            }

            const item = new MultimediaItem({
                title: finalTitle,
                url: url,
                posterUrl: tmdbData?.poster || poster,
                bannerUrl: tmdbData?.backdrop,
                description: tmdbData?.description || description,
                year: tmdbData?.year ? parseInt(tmdbData.year) : null,
                score: tmdbData?.rating,
                tags: tmdbData?.genres,
                cast: tmdbData?.cast,
                type: isMovie ? "movie" : "series",
                contentType: isMovie ? "movie" : "series"
            });

            if (isMovie) {
                const content = doc.querySelector('.page-body') || doc.querySelector('main') || doc;
                const links = Array.from(content.querySelectorAll('a'))
                    .map(a => ({
                        text: a.textContent.trim(),
                        href: a.getAttribute('href')
                    }))
                    .filter(l => l.href && (l.href.includes("hdstream4u") || l.href.includes("hubstream") || l.text.match(/480|720|1080|2160|4k/i)) && !l.href.includes(MAIN_URL));
                
                item.episodes = [
                    new Episode({
                        name: "Play",
                        url: JSON.stringify(links.map(l => ({ url: l.href, name: l.text }))),
                        season: 1,
                        episode: 1
                    })
                ];
            } else {
                // Series logic
                const episodesMap = {};
                const content = doc.querySelector('.page-body') || doc.querySelector('main') || doc;
                const allElements = content.querySelectorAll('h3, h4, p, span, strong');
                
                let currentEpNum = null;
                for (const el of Array.from(allElements)) {
                    const text = el.textContent.trim();
                    const epMatch = text.match(/(?:Episode|E|Ep|EPiSODE)\s*(\d+)/i);
                    
                    if (epMatch) {
                        currentEpNum = parseInt(epMatch[1]);
                        if (!episodesMap[currentEpNum]) episodesMap[currentEpNum] = [];
                    }

                    if (currentEpNum) {
                        const elLinks = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(Boolean);
                        for (const link of elLinks) {
                            if (!link.includes(MAIN_URL) && !episodesMap[currentEpNum].includes(link)) {
                                episodesMap[currentEpNum].push(link);
                            }
                        }
                    }

                    // Direct "All Episodes" link blocks
                    const aTags = Array.from(el.querySelectorAll('a'));
                    for (const a of aTags) {
                        const aText = a.textContent.trim().toLowerCase();
                        const pText = a.parentElement?.textContent?.toLowerCase() || "";
                        const combinedText = aText + " " + pText;
                        
                        if (combinedText.match(/480|720|1080|2160|4k/i) && (combinedText.includes("download") || combinedText.includes("zip") || combinedText.includes("pack"))) {
                            const link = a.getAttribute('href');
                            if (link && !link.includes(MAIN_URL)) {
                                try {
                                    const resolvedUrl = await getRedirectLinks(link);
                                    if (resolvedUrl) {
                                        const epRes = await http_get(resolvedUrl, { headers: HEADERS });
                                        const epDoc = await parseHtml(epRes.body);
                                        epDoc.querySelectorAll('h5 a, p a, a').forEach(aElement => {
                                            const epText = aElement.textContent;
                                            const epLink = aElement.getAttribute('href');
                                            const epNumMatch = epText.match(/(?:Episode|E|Ep|EPiSODE)\s*(\d+)/i);
                                            if (epNumMatch && epLink) {
                                                const epNum = parseInt(epNumMatch[1]);
                                                if (!episodesMap[epNum]) episodesMap[epNum] = [];
                                                if (!episodesMap[epNum].includes(epLink)) {
                                                    episodesMap[epNum].push(epLink);
                                                }
                                            }
                                        });
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }

                // Fallback for Season Packs if still empty
                if (Object.keys(episodesMap).length === 0) {
                    const fallbackLinks = Array.from(content.querySelectorAll('a'))
                        .filter(a => {
                            const t = (a.textContent + " " + (a.parentElement?.textContent || "")).toLowerCase();
                            return t.match(/480|720|1080|2160|4k/i) && !a.getAttribute('href')?.includes(MAIN_URL);
                        })
                        .map(a => a.getAttribute('href'))
                        .filter(Boolean);
                    
                    if (fallbackLinks.length > 0) {
                        const totalEpisodes = Object.keys(tmdbSeasonEpisodes).length || 1;
                        const uniqueLinks = [...new Set(fallbackLinks)];
                        for (let i = 1; i <= totalEpisodes; i++) {
                            episodesMap[i] = uniqueLinks;
                        }
                    }
                }

                item.episodes = Object.keys(episodesMap).sort((a,b) => a-b).map(epNum => {
                    const epInfo = tmdbSeasonEpisodes[epNum];
                    const epLinks = [...new Set(episodesMap[epNum])].map(u => ({ url: u }));
                    return new Episode({
                        name: epInfo?.name || `Episode ${epNum}`,
                        description: epInfo?.description,
                        posterUrl: epInfo?.posterUrl,
                        url: JSON.stringify(epLinks),
                        season: seasonNumber,
                        episode: parseInt(epNum)
                    });
                });
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    function rot13(value) {
        return (value || "").replace(/[a-zA-Z]/g, function(c) {
            return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
        });
    }

    async function getRedirectLinks(url) {
        try {
            const response = await http_get(url, { headers: HEADERS });
            if (response.status !== 200) return null;
            const doc = response.body;

            const regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
            let combinedString = "";
            let match;
            while ((match = regex.exec(doc)) !== null) {
                const extractedValue = match[1] || match[2];
                if (extractedValue) combinedString += extractedValue;
            }

            if (!combinedString) {
                const redirectMatch = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
                if (redirectMatch && redirectMatch[1]) {
                    const newUrl = redirectMatch[1];
                    if (newUrl !== url && !newUrl.includes(url)) {
                        return await getRedirectLinks(newUrl);
                    }
                }
                return null;
            }

            const decodedString = atob(rot13(atob(atob(combinedString))));
            const jsonObject = JSON.parse(decodedString);
            const encodedUrl = atob(jsonObject.o || "").trim();
            if (encodedUrl) return encodedUrl;

            const data = atob(jsonObject.data || "").trim();
            const wpHttp = (jsonObject.blog_url || "").trim();
            if (wpHttp && data) {
                const directLinkResponse = await http_get(`${wpHttp}?re=${data}`, { headers: HEADERS });
                return directLinkResponse.body.trim();
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async function hubCloudExtractor(url, referer) {
        try {
            let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
            const res = await http_get(currentUrl, { headers: { ...HEADERS, "Referer": referer } });
            let pageData = res.body;
            let finalUrl = currentUrl;

            if (!currentUrl.includes("hubcloud.php")) {
                let nextHref = "";
                const doc = await parseHtml(pageData);
                const downloadBtn = doc.querySelector("#download");
                if (downloadBtn) {
                    nextHref = downloadBtn.getAttribute("href");
                } else {
                    const scriptUrlMatch = pageData.match(/var url = '([^']*)'/);
                    if (scriptUrlMatch) nextHref = scriptUrlMatch[1];
                }

                if (nextHref) {
                    if (!nextHref.startsWith("http")) {
                        const urlObj = new URL(currentUrl);
                        nextHref = `${urlObj.protocol}//${urlObj.hostname}/${nextHref.replace(/^\//, "")}`;
                    }
                    finalUrl = nextHref;
                    const res2 = await http_get(finalUrl, { headers: { ...HEADERS, "Referer": currentUrl } });
                    pageData = res2.body;
                }
            }

            const $ = await parseHtml(pageData);
            const size = $.querySelector("i#size")?.textContent?.trim() || "";
            const header = $.querySelector("div.card-header")?.textContent?.trim() || "";
            const qualityStr = header.match(/(\d{3,4})[pP]/)?.[1];
            const quality = qualityStr ? parseInt(qualityStr) : 1080;

            const links = [];
            $.querySelectorAll("a.btn").forEach(element => {
                const link = element.getAttribute("href");
                const text = element.textContent.toLowerCase();
                if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") || text.includes("fslv2") || text.includes("mega server")) {
                    links.push(new StreamResult({
                        name: `HubCloud [${text.includes('fsl') ? 'FSL' : 'Direct'}]`,
                        url: link,
                        quality: qualityStr || "1080p",
                        size: size
                    }));
                } else if (link && link.includes("pixeldra")) {
                    links.push(new StreamResult({
                        name: "PixelDrain",
                        url: link.includes("?download") ? link : `https://pixeldrain.com/api/file/${link.split('/').pop()}?download`,
                        quality: qualityStr || "1080p",
                        size: size
                    }));
                }
            });
            return links;
        } catch (e) {
            return [];
        }
    }

    async function hubCdnExtractor(url, referer) {
        try {
            const res = await http_get(url, { headers: { ...HEADERS, "Referer": referer } });
            const data = res.body;
            let encoded = data.match(/r=([A-Za-z0-9+/=]+)/)?.[1];
            if (!encoded) {
                const scriptEncoded = data.match(/reurl\s*=\s*["']([^"']+)["']/)?.[1];
                if (scriptEncoded) encoded = scriptEncoded.split("?r=").pop();
            }
            if (encoded) {
                const m3u8Link = atob(encoded).substring(atob(encoded).lastIndexOf("link=") + 5);
                return [new StreamResult({ source: "HubCdn", url: m3u8Link, quality: "1080p" })];
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    async function hubDriveExtractor(url, referer) {
        try {
            const res = await http_get(url, { headers: { ...HEADERS, "Referer": referer } });
            const doc = await parseHtml(res.body);
            const href = doc.querySelector(".btn.btn-primary.btn-user.btn-success1.m-1")?.getAttribute("href");
            if (href) {
                if (href.includes("hubcloud")) return await hubCloudExtractor(href, url);
                return await internalLoadExtractor(href, url);
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    async function hbLinksExtractor(url) {
        try {
            const res = await http_get(url, { headers: { ...HEADERS, "Referer": url } });
            const doc = await parseHtml(res.body);
            const links = Array.from(doc.querySelectorAll("h3 a, h5 a, div.entry-content p a"))
                .map(a => a.getAttribute("href"))
                .filter(Boolean);
            
            const results = [];
            for (const l of links) {
                const streams = await internalLoadExtractor(l, url);
                results.push(...streams);
            }
            return results;
        } catch (e) {
            return [];
        }
    }

    async function vidStackExtractor(url) {
        try {
            const hash = url.split("#").pop().split("/").pop();
            const baseUrl = new URL(url).origin;
            const apiUrl = `${baseUrl}/api/v1/video?id=${hash}`;
            
            const response = await http_get(apiUrl, { headers: { ...HEADERS, "Referer": url } });
            const encoded = response.body.trim();
            
            const key = btoa("kiemtienmua911ca"); // Convert to base64 for the bridge
            const ivs = [btoa("1234567890oiuytr"), btoa("0123456789abcdef")];
            
            for (const ivB64 of ivs) {
                try {
                    const decryptedText = await globalThis.crypto.decryptAES(encoded, key, ivB64);
                    if (decryptedText && decryptedText.includes("source")) {
                        const m3u8Match = decryptedText.match(/"source":"(.*?)"/);
                        const m3u8 = m3u8Match ? m3u8Match[1].replace(/\\/g, "") : null;
                        
                        if (m3u8) {
                            return [new StreamResult({
                                source: "Hubstream",
                                url: m3u8.replace("https:", "http:"),
                                headers: {
                                    "Referer": url,
                                    "Origin": url.split("/").pop()
                                }
                            })];
                        }
                    }
                } catch (e) {}
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    async function internalLoadExtractor(url, referer = MAIN_URL) {
        try {
            const hostname = new URL(url).hostname;
            const isRedirect = url.includes("?id=") || ["techyboy4u", "gadgetsweb.xyz", "cryptoinsights.site", "bloggingvector", "ampproject.org"].some(h => hostname.includes(h));
            
            if (isRedirect) {
                const finalLink = await getRedirectLinks(url);
                if (finalLink && finalLink !== url) return await internalLoadExtractor(finalLink, url);
                return [];
            }
            
            if (hostname.includes("hubcloud")) return await hubCloudExtractor(url, referer);
            if (hostname.includes("hubcdn")) return await hubCdnExtractor(url, referer);
            if (hostname.includes("hubdrive")) return await hubDriveExtractor(url, referer);
            if (hostname.includes("hblinks") || hostname.includes("hubstream.dad")) return await hbLinksExtractor(url);
            if (hostname.includes("hubstream") || hostname.includes("vidstack")) return await vidStackExtractor(url);
            if (hostname.includes("pixeldrain")) {
                return [new StreamResult({
                    source: "PixelDrain",
                    url: url.includes("?download") ? url : `https://pixeldrain.com/api/file/${url.split('/').pop()}?download`
                })];
            }
            if (hostname.includes("hdstream4u")) {
                return [new StreamResult({ source: "HdStream4u", url: url })];
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    async function loadStreams(data, cb) {
        try {
            // Data can be a URL string or an object with url property
            let url = data;
            if (typeof data === 'string' && data.startsWith('[')) {
                const parsed = JSON.parse(data);
                url = parsed[0]?.url || parsed[0];
            } else if (typeof data === 'object') {
                url = data.url || data[0]?.url;
            }

            if (!url) return cb({ success: true, data: [] });

            if (typeof url === 'string' && url.startsWith('[')) {
                const links = JSON.parse(url);
                const allResults = [];
                for (const l of links) {
                    const lUrl = typeof l === 'string' ? l : l.url;
                    if (lUrl) {
                        const res = await internalLoadExtractor(lUrl);
                        allResults.push(...res);
                    }
                }
                return cb({ success: true, data: allResults });
            }

            const results = await internalLoadExtractor(url);
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    const plugin = {
        search: search,
        getHome: getHome,
        load: load,
        loadStreams: loadStreams
    };

    // Export to globalThis for skystream test
    globalThis.search = search;
    globalThis.getHome = getHome;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
