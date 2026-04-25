(function() {
    const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
    const TMDB_BASE_URL = "https://api.themoviedb.org/3";
    const MAIN_URL = "https://new5.hdhub4u.fo";
    
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

            const response = await http_get(searchUrl, HEADERS);
            
            const data = JSON.parse(response.body);

            if (!data || !data.hits) {
                return cb({ success: true, data: [] });
            }

            const results = data.hits.map((hit) => {
                const doc = hit.document;
                if (!doc) return null;
                const title = doc.post_title || "Unknown";
                const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
                const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
                let url = doc.permalink;
                if (url && url.startsWith("/")) {
                    url = `${MAIN_URL}${url}`;
                } else if (url && !url.startsWith("http")) {
                    url = `${MAIN_URL}/${url}`;
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
            }).filter(Boolean);

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
                        let href = el.querySelector('figure a')?.getAttribute('href');
                        if (href && href.startsWith("/")) href = `${MAIN_URL}${href}`;
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
        console.log("HDHub4U: getRedirectLinks for: " + url);
        try {
            const response = await http_get(url, { headers: HEADERS });
            if (response.status !== 200) {
                console.log("HDHub4U: getRedirectLinks HTTP " + response.status + " for " + url);
                return null;
            }
            const doc = response.body;
            console.log("HDHub4U: getRedirectLinks body len: " + doc.length);
            console.log("HDHub4U: getRedirectLinks body end sample: " + doc.substring(doc.length - 1000).replace(/\n/g, " "));

            // Search for all potential tokens in the entire body
            const allBase64 = doc.match(/[A-Za-z0-9+/=]{50,}/g) || [];
            console.log("HDHub4U: getRedirectLinks found " + allBase64.length + " potential tokens (>50 chars)");
            
            for (const token of allBase64) {
                try {
                    const s1 = atob(token);
                    const s2 = rot13(s1);
                    const s3 = atob(s2);
                    const decoded = atob(s3);
                    if (decoded && decoded.includes("{")) {
                        console.log("HDHub4U: getRedirectLinks found VALID JSON in token len " + token.length);
                        const json = JSON.parse(decoded);
                        const encodedUrl = atob(json.o || "").trim();
                        if (encodedUrl) return encodedUrl;

                        const data = atob(json.data || "").trim();
                        const wpHttp = (json.blog_url || "").trim();
                        if (wpHttp && data) {
                            const drRes = await http_get(`${wpHttp}?re=${data}`, { headers: HEADERS });
                            const b = drRes.body.trim();
                            if (b.startsWith("http")) return b;
                            const bDoc = await parseHtml(b);
                            return bDoc.querySelector("body")?.textContent?.trim() || b;
                        }
                    }
                } catch (e) {}
            }

            // Fallback for anchors that might be the next step
            const doc2 = await parseHtml(doc);
            const anchors = doc2.querySelectorAll("a");
            console.log("HDHub4u: getRedirectLinks found " + anchors.length + " total anchors");
            for (const a of anchors) {
                const href = a.getAttribute("href") || "";
                if (href.includes("techyboy") || href.includes("gadgetsweb") || href.includes("cryptoinsights")) {
                    console.log("HDHub4u: getRedirectLinks found relevant anchor: " + href);
                    if (href !== url && !href.includes(url)) return await getRedirectLinks(href);
                }
            }

            // Final fallback: standard regex or meta redirects
            console.log("HDHub4U: getRedirectLinks falling back to standard redirects");
            const nextMatch = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]|URL\s*=\s*['"]([^'"]+)['"]|\?next=([^'"]+)|\?id=([^'"]+)/i);
            if (nextMatch) {
                const nextUrl = nextMatch[1] || nextMatch[2] || nextMatch[3] || nextMatch[4];
                if (nextUrl && nextUrl !== url && !nextUrl.includes(url)) {
                    // If it's a relative URL or just a query string
                    let finalNext = nextUrl;
                    if (nextUrl.startsWith("?")) {
                        const baseUrl = new URL(url);
                        finalNext = `${baseUrl.origin}${baseUrl.pathname}${nextUrl}`;
                    } else if (!nextUrl.startsWith("http")) {
                        const baseUrl = new URL(url);
                        if (baseUrl.hostname.includes("cryptoinsights.site")) {
                             // Hard fix: these links are ALWAYS under /homelander/
                             finalNext = `${baseUrl.origin}/homelander/${nextUrl.replace(/^\//, "")}`;
                        } else {
                            const pathParts = baseUrl.pathname.split("/");
                            pathParts.pop();
                            const basePath = pathParts.join("/");
                            finalNext = `${baseUrl.origin}${basePath}/${nextUrl.replace(/^\//, "")}`;
                        }
                    }
                    console.log("HDHub4U: getRedirectLinks recursing to: " + finalNext);
                    return await getRedirectLinks(finalNext);
                }
            }

            // Fallback for script-based redirects inside the body
            const scriptMatch = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]|location\.replace\(['"]([^'"]+)['"]\)/i);
            if (scriptMatch) {
                const sUrl = scriptMatch[1] || scriptMatch[2];
                if (sUrl && sUrl !== url && !sUrl.includes(url)) {
                    let fUrl = sUrl;
                    if (!sUrl.startsWith("http")) {
                        const bu = new URL(url);
                        fUrl = `${bu.origin}/${sUrl.replace(/^\//, "")}`;
                    }
                    console.log("HDHub4U: getRedirectLinks script recurse: " + fUrl);
                    return await getRedirectLinks(fUrl);
                }
            }
            const metaMatch = doc.match(/meta http-equiv="refresh" content=".*url=(.*?)"/i);
            if (metaMatch && metaMatch[1]) return metaMatch[1];

            return null;
        } catch (e) {
            console.error("HDHub4U: getRedirectLinks Error: " + e.message);
            return null;
        }
    }

    async function hubCloudExtractor(url, referer) {
        console.log("HDHub4U: hubCloudExtractor for: " + url);
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
                    console.log("HDHub4U: HubCloud next step: " + nextHref);
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
            const headerDetails = cleanTitle(header);
            const labelExtras = (headerDetails ? `[${headerDetails}]` : "") + (size ? `[${size}]` : "");

            const links = [];
            const elements = $.querySelectorAll("a.btn");
            console.log("HDHub4U: HubCloud found " + elements.length + " buttons");
            for (const element of elements) {
                const link = element.getAttribute("href");
                const text = element.textContent.toLowerCase();
                
                if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") || text.includes("fslv2") || text.includes("mega server")) {
                    let label = "HubCloud";
                    if (text.includes("fsl server")) label = "HubCloud [FSL]";
                    else if (text.includes("s3 server")) label = "HubCloud [S3]";
                    else if (text.includes("fslv2")) label = "HubCloud [FSLv2]";
                    else if (text.includes("mega server")) label = "HubCloud [Mega]";
                    
                    links.push(new StreamResult({
                        source: label,
                        name: `${label} ${labelExtras}`,
                        url: link,
                        quality: qualityStr || "1080p",
                        size: size
                    }));
                } else if (text.includes("buzzserver")) {
                    try {
                        console.log("HDHub4U: HubCloud BuzzServer: " + link);
                        const buzzResp = await http_get(`${link}/download`, { headers: { ...HEADERS, "Referer": link } });
                        let dlink = buzzResp.headers["hx-redirect"] || buzzResp.headers["HX-Redirect"];
                        if (dlink) {
                            links.push(new StreamResult({
                                source: "BuzzServer",
                                name: `BuzzServer ${labelExtras}`,
                                url: dlink,
                                quality: qualityStr || "1080p",
                                size: size
                            }));
                        }
                    } catch (e) {}
                } else if (text.includes("10gbps")) {
                    try {
                        console.log("HDHub4U: HubCloud 10Gbps: " + link);
                        const resp = await http_get(link, { headers: HEADERS });
                        const loc = resp.headers["location"];
                        if (loc && loc.includes("link=")) {
                            const dlink = loc.substring(loc.indexOf("link=") + 5);
                            links.push(new StreamResult({
                                source: "10Gbps",
                                name: `10Gbps ${labelExtras}`,
                                url: dlink,
                                quality: qualityStr || "1080p",
                                size: size
                            }));
                        }
                    } catch (e) {}
                } else if (link && link.includes("pixeldra")) {
                    links.push(new StreamResult({
                        name: "PixelDrain",
                        url: link.includes("?download") ? link : `https://pixeldrain.com/api/file/${link.split('/').pop()}?download`,
                        quality: qualityStr || "1080p",
                        size: size
                    }));
                } else if (link && link.startsWith("http") && !link.includes("facebook.com") && !link.includes("twitter.com")) {
                    console.log("HDHub4U: HubCloud nested check: " + link);
                    const extracted = await internalLoadExtractor(link, finalUrl);
                    links.push(...extracted.map(l => {
                        l.quality = l.quality || qualityStr || "1080p";
                        l.size = l.size || size;
                        return l;
                    }));
                }
            }
            return links;
        } catch (e) {
            console.error("HDHub4U: hubCloudExtractor Error: " + e.message);
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
            
            // Convert hex to base64 for the Dart bridge which expects base64
            const encodedB64 = btoa(encoded.match(/\w{2}/g).map(a => String.fromCharCode(parseInt(a, 16))).join(""));

            for (const ivB64 of ivs) {
                try {
                    const decryptedText = await globalThis.crypto.decryptAES(encodedB64, key, ivB64);
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

    async function streamTapeExtractor(url) {
        try {
            const res = await http_get(url, { headers: HEADERS });
            const data = res.body;
            let videoSrc = data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/)?.[1];
            if (videoSrc) {
                const parts = videoSrc.match(/'([^']+)'/g).map(p => p.slice(1, -1));
                const finalUrl = "https:" + parts.join("");
                return [new StreamResult({ source: "StreamTape", url: finalUrl, quality: "720p" })];
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
                const res = await getRedirectLinks(url);
                if (res) {
                    // Strip leading ? or & if present (sometimes atob returns it)
                    let cleanRes = res.trim();
                    if (cleanRes.startsWith("?") || cleanRes.startsWith("&")) {
                        cleanRes = cleanRes.substring(1);
                    }
                    
                    if (cleanRes.startsWith("http")) {
                        console.log("HDHub4U: internalLoadExtractor redirected to: " + cleanRes);
                        return await internalLoadExtractor(cleanRes, url);
                    } else if (cleanRes.includes("hubcloud") || cleanRes.includes("hubcdn") || cleanRes.includes("hubdrive")) {
                        // Likely a path or partial URL
                        const baseUrl = new URL(url);
                        const fullUrl = cleanRes.startsWith("/") ? `${baseUrl.origin}${cleanRes}` : `${baseUrl.origin}/${cleanRes}`;
                        return await internalLoadExtractor(fullUrl, url);
                    }
                }
                return [];
            }
            
            if (hostname.includes("hubcloud")) return await hubCloudExtractor(url, referer);
            if (hostname.includes("hubcdn")) return await hubCdnExtractor(url, referer);
            if (hostname.includes("hubdrive")) return await hubDriveExtractor(url, referer);
            if (hostname.includes("hblinks") || hostname.includes("hubstream.dad")) return await hbLinksExtractor(url);
            if (hostname.includes("hubstream") || hostname.includes("vidstack")) return await vidStackExtractor(url);
            if (hostname.includes("streamtape")) return await streamTapeExtractor(url);
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
            console.error(`HDHub4U: internalLoadExtractor error for ${url}: ${e.message}`);
            return [];
        }
    }

    async function loadStreams(data, cb) {
        console.log("HDHub4U: Starting loadStreams for data: " + (typeof data === 'string' ? data.substring(0, 100) : "object"));
        try {
            let links = [];
            if (typeof data === 'string' && data.startsWith('[')) {
                links = JSON.parse(data);
            } else if (Array.isArray(data)) {
                links = data;
            } else if (typeof data === 'object' && data.url) {
                if (data.url.startsWith('[')) {
                    links = JSON.parse(data.url);
                } else {
                    links = [{ url: data.url }];
                }
            } else if (typeof data === 'string') {
                links = [{ url: data }];
            }

            if (!links || links.length === 0) {
                console.log("HDHub4U: No links provided in data");
                return cb({ success: true, data: [] });
            }

            console.log("HDHub4U: Processing " + links.length + " initial links");
            const allResults = [];
            
            // Deduplicate initial links by URL
            const uniqueLinks = [];
            const seenInitialUrls = new Set();
            for (const l of links) {
                const u = typeof l === 'string' ? l : l.url;
                if (u && !seenInitialUrls.has(u)) {
                    seenInitialUrls.add(u);
                    uniqueLinks.push(typeof l === 'string' ? { url: u, name: "" } : l);
                }
            }
            
            for (const lObj of uniqueLinks) {
                try {
                    const lUrl = lObj.url;
                    const lName = lObj.name || "";
                    console.log("HDHub4U: Extracting from: " + lUrl + " (name: " + lName + ")");
                    const streams = await internalLoadExtractor(lUrl);

                    // Apply quality formatting based on original link name
                    streams.forEach(s => {
                        let finalQuality = s.quality && s.quality !== "Unknown" ? s.quality : "";

                        const resMatch = lName.match(/(2160p|1080p|720p|480p|360p|4K|8K)/i);
                        if (resMatch && !finalQuality) {
                            finalQuality = resMatch[1];
                        }

                        const extMatch = lName.match(/\[(.*?)\]/);
                        const extInfo = extMatch ? ` ${extMatch[0]}` : "";

                        let sourceLabel = s.source;
                        if (finalQuality && !sourceLabel.includes(finalQuality)) {
                            sourceLabel = `${sourceLabel} - ${finalQuality}`;
                        }
                        if (extInfo && !sourceLabel.includes(extInfo.trim())) {
                            sourceLabel = `${sourceLabel}${extInfo}`;
                        }

                        s.source = sourceLabel;
                        allResults.push(s);
                    });
                } catch (e) {
                    console.error("HDHub4U: Extraction error for " + lObj.url + ": " + e.message);
                }
            }

            // Deduplicate final results by URL
            const seen = new Set();
            const finalResults = allResults.filter(item => {
                if (seen.has(item.url)) return false;
                seen.add(item.url);
                return true;
            });

            console.log("HDHub4U: Found " + finalResults.length + " final streams");
            cb({ success: true, data: finalResults });
        } catch (e) {
            console.error("HDHub4U: loadStreams Critical Error: " + e.message);
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
