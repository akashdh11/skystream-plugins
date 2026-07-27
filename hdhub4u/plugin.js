(function() {
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API_URL = "https://api.themoviedb.org/3";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const runtimeManifest = (typeof manifest !== "undefined" && manifest) ? manifest : {};
    let MAIN_URL = String(runtimeManifest.baseUrl || "https://hdhub4u.glass").replace(/\/+$/, "");
    let domainResolved = false;

    async function resolveBaseUrl() {
        if (domainResolved) return;
        domainResolved = true;
        try {
            const res = await http_get("https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json", { headers: { "User-Agent": "Mozilla/5.0" } });
            const json = JSON.parse(res.body || "{}");
            if (json.HDHUB4u) {
                MAIN_URL = String(json.HDHUB4u).replace(/\/+$/, "");
                HEADERS["Referer"] = `${MAIN_URL}/`;
            }
        } catch (_) {}
    }
    
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

    function safeJsonParse(value, fallback = null) {
        if (value && typeof value === "object") return value;
        try {
            return JSON.parse(String(value || ""));
        } catch (_) {
            return fallback;
        }
    }

    async function fetchJson(url, headers = {}, fallback = {}) {
        try {
            const response = await http_get(url, { headers: headers });
            return safeJsonParse(response.body, fallback);
        } catch (_) {
            return fallback;
        }
    }

    function tmdbApi(path, query = "") {
        const cleanPath = String(path || "").replace(/^\/+/, "");
        const prefix = `${TMDB_API_URL}/${cleanPath}?api_key=${TMDB_API_KEY}`;
        return query ? `${prefix}&${query}` : prefix;
    }

    function normalizeAbsoluteUrl(url) {
        const value = String(url || "").trim();
        if (!value) return "";
        try {
            return new URL(value, MAIN_URL).href;
        } catch (_) {
            return value;
        }
    }

    function makeTrailer(url) {
        const value = normalizeAbsoluteUrl(url);
        if (!value) return null;
        try {
            if (typeof Trailer !== "undefined") return new Trailer({ url: value });
        } catch (_) {}
        return { url: value };
    }

    function extractImdbId(value) {
        return String(value || "").match(/tt\d+/i)?.[0] || "";
    }

    function buildSyncData(tmdbId, imdbId) {
        const syncData = {};
        if (tmdbId) syncData.tmdb = String(tmdbId);
        if (imdbId) syncData.imdb = imdbId;
        return syncData;
    }

    function parseRecommendationCard(el) {
        const a = el.querySelector("figcaption a") || el.querySelector("figure a") || el.querySelector("a");
        const figureLink = el.querySelector("figure a") || a;
        if (!a || !figureLink) return null;
        const titleText = (a.textContent || "").replace(/\|.*$/, "").trim();
        const href = normalizeSiteUrl(figureLink.getAttribute("href"));
        const poster = el.querySelector("figure img")?.getAttribute("src") || el.querySelector("img")?.getAttribute("src");
        if (!titleText || !href) return null;
        const isSeries = inferIsSeries(titleText, href, "");
        return new MultimediaItem({
            title: titleText,
            url: href,
            posterUrl: poster,
            type: isSeries ? "series" : "movie",
            contentType: isSeries ? "series" : "movie"
        });
    }

    function parseRecommendations(doc, currentUrl) {
        const seen = new Set([normalizeSiteUrl(currentUrl)]);
        const cards = Array.from(doc.querySelectorAll(".related-posts li.thumb, .related-post li.thumb, .recent-movies > li.thumb, .widget-recent .thumb, div.thumb, li.thumb"));
        const out = [];
        for (const card of cards) {
            const item = parseRecommendationCard(card);
            if (!item || seen.has(item.url)) continue;
            seen.add(item.url);
            out.push(item);
            if (out.length >= 12) break;
        }
        return out;
    }

    function inferIsSeries(title, url, categories) {
        const combined = `${title || ""} ${categories || ""} ${url || ""}`.toLowerCase();
        return /all-episodes|web[- ]series|tv[- ]series|season\s*\d+|\/season-|\/all-episodes|\/series\//i.test(combined);
    }

    function normalizeSiteUrl(url) {
        const value = String(url || "");
        if (!value) return value;
        try {
            const parsed = new URL(value, MAIN_URL);
            if (/hdhub4u\./i.test(parsed.hostname) && !parsed.href.startsWith(MAIN_URL)) {
                return `${MAIN_URL}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
            return parsed.href;
        } catch (_) {
            return value;
        }
    }

    async function withTimeout(promise, ms, fallback) {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise(resolve => {
                    timer = setTimeout(() => resolve(fallback), ms);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function mapLimit(items, limit, worker) {
        const list = Array.isArray(items) ? items : [];
        const max = Math.max(1, Number(limit || 1));
        const results = new Array(list.length);
        let index = 0;
        async function run() {
            while (index < list.length) {
                const current = index++;
                try {
                    results[current] = await worker(list[current], current);
                } catch (_) {
                    results[current] = [];
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(max, list.length) }, run));
        return results;
    }

    async function fetchMany(requests) {
        const normalized = requests.map(req => ({
            url: req.url,
            headers: req.headers || HEADERS,
            meta: req.meta
        }));

        if (typeof http_parallel === "function") {
            try {
                const responses = await http_parallel(normalized.map(req => ({ url: req.url, headers: req.headers })));
                if (Array.isArray(responses)) {
                    return responses.map((response, index) => ({ ...(response || {}), meta: normalized[index].meta }));
                }
            } catch (_) {}
        }

        return await Promise.all(normalized.map(async req => {
            try {
                const response = await http_get(req.url, { headers: req.headers });
                return { ...(response || {}), meta: req.meta };
            } catch (_) {
                return { body: "", meta: req.meta };
            }
        }));
    }

    async function searchOnSite(query) {
        try {
            const urls = [
                `${MAIN_URL}/search/${encodeURIComponent(query)}`,
                `${MAIN_URL}/?s=${encodeURIComponent(query)}`
            ];
            for (const url of urls) {
                try {
                    const res = await http_get(url, { headers: HEADERS });
                    if (!res || !res.body) continue;
                    const doc = await parseHtml(res.body);
                    const items = Array.from(doc.querySelectorAll('.recent-movies > li.thumb, li.thumb, .movie-card')).map(el => {
                        const a = el.querySelector('figcaption a') || el.querySelector('a');
                        if (!a) return null;
                        const titleText = a.textContent.trim();
                        let href = el.querySelector('figure a')?.getAttribute('href') || a.getAttribute('href');
                        if (href && href.startsWith("/")) href = `${MAIN_URL}${href}`;
                        href = normalizeSiteUrl(href);
                        const poster = el.querySelector('figure img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('src');
                        const isSeries = inferIsSeries(titleText, href, "");
                        return new MultimediaItem({
                            title: titleText.replace(/\|.*$/, "").trim(),
                            url: href,
                            posterUrl: poster,
                            type: isSeries ? "series" : "movie",
                            contentType: isSeries ? "series" : "movie"
                        });
                    }).filter(Boolean);
                    if (items.length > 0) return items;
                } catch (_) {}
            }
            return [];
        } catch (_) {
            return [];
        }
    }

    async function search(query, cb) {
        try {
            await resolveBaseUrl();
            const today = (new Date()).toISOString().split("T")[0];
            const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=${encodeURIComponent(query)}&query_by=post_title,category,stars,director,imdb_id&query_by_weights=4,2,2,2,4&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;

            const requestHeaders = {
                ...HEADERS,
                "Referer": `${MAIN_URL}/`,
                "Origin": MAIN_URL
            };

            const data = await fetchJson(searchUrl, requestHeaders, {});

            if (data && data.hits && data.hits.length > 0) {
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
                    url = normalizeSiteUrl(url);
                    
                    const categories = Array.isArray(doc.category) ? doc.category.join(" ") : (doc.category || "");
                    const isSeries = inferIsSeries(title, url, categories);

                    return new MultimediaItem({
                        title: title.replace(/\|.*$/, "").trim(),
                        url: url,
                        posterUrl: doc.post_thumbnail,
                        year: year,
                        type: isSeries ? "series" : "movie",
                        contentType: isSeries ? "series" : "movie"
                    });
                }).filter(Boolean);

                return cb({ success: true, data: results });
            }

            const scraped = await searchOnSite(query);
            cb({ success: true, data: scraped });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    async function getHomeFromSite() {
        const sections = [
            { name: "Latest", path: "" },
            { name: "Bollywood", path: "/category/bollywood-movies/" },
            { name: "Hollywood", path: "/category/hollywood-movies/" },
            { name: "Hindi Dubbed", path: "/category/hindi-dubbed/" },
            { name: "South Hindi", path: "/category/south-hindi-movies/" },
            { name: "Web Series", path: "/category/web-series/" }
        ];

        const base = MAIN_URL;
        const results = await Promise.all(sections.map(async (section) => {
            try {
                const url = section.path ? `${base}${section.path}page/1/` : `${base}/page/1/`;
                const res = await http_get(url, { headers: HEADERS });
                const doc = await parseHtml(res.body);
                const items = Array.from(doc.querySelectorAll('.recent-movies > li.thumb')).map(el => {
                    const a = el.querySelector('figcaption a');
                    if (!a) return null;
                    const titleText = a.textContent.trim();
                    let href = el.querySelector('figure a')?.getAttribute('href');
                    if (href && href.startsWith("/")) href = `${base}${href}`;
                    href = normalizeSiteUrl(href);
                    const poster = el.querySelector('figure img')?.getAttribute('src');
                    const isSeries = inferIsSeries(titleText, href, "");
                    return new MultimediaItem({
                        title: titleText.replace(/\|.*$/, "").trim(),
                        url: href,
                        posterUrl: poster,
                        type: isSeries ? "series" : "movie",
                        contentType: isSeries ? "series" : "movie"
                    });
                }).filter(Boolean);
                return { name: section.name, items };
            } catch (err) {
                return { name: section.name, items: [] };
            }
        }));
        const result = {};
        for (const { name, items } of results) {
            result[name] = items;
        }
        return result;
    }

    async function getTMDBLogoUrl(tmdbId, mediaType) {
        try {
            const endpoint = mediaType === "tv" ? "tv" : "movie";
            const url = tmdbApi(`${endpoint}/${tmdbId}`, "append_to_response=external_ids");
            const data = await fetchJson(url, { "Accept": "application/json" }, {});
            const imdbId = data.external_ids?.imdb_id;
            return imdbId ? `https://live.metahub.space/logo/medium/${imdbId}/img` : null;
        } catch (_) {
            return null;
        }
    }

    async function enrichItemWithTMDB(item) {
        const title = item.title || "";
        const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
        const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
        const cleanT = normalizeLookupTitle(title, item.type !== "series");
        try {
            const tmdbId = await searchTMDBIdByTitle(cleanT || title, item.type !== "series", year);
            if (tmdbId) {
                const logoUrl = await getTMDBLogoUrl(tmdbId, item.type === "series" ? "tv" : "movie");
                if (logoUrl) item.logoUrl = logoUrl;
            }
        } catch (_) {}
        return item;
    }

    async function getHome(cb) {
        try {
            await resolveBaseUrl();
            const scraped = await getHomeFromSite();
            if (scraped && scraped["Latest"] && scraped["Latest"].length > 0) {
                const trendingRaw = scraped["Latest"].slice(0, 8);
                scraped["Trending"] = await Promise.all(trendingRaw.map(item => enrichItemWithTMDB(item)));
                return cb({ success: true, data: scraped });
            }

            const today = (new Date()).toISOString().split("T")[0];
            const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=&query_by=post_title,category,stars,director,imdb_id&query_by_weights=4,2,2,2,4&sort_by=sort_by_date:desc&limit=50&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;

            const requestHeaders = {
                ...HEADERS,
                "Referer": `${MAIN_URL}/`,
                "Origin": MAIN_URL
            };
            const data = await fetchJson(searchUrl, requestHeaders, {});

            if (data && data.hits && data.hits.length > 0) {
                const categoryMap = {
                    "BollyWood": "Bollywood",
                    "HollyWood": "Hollywood",
                    "Hindi Dubbed": "Hindi Dubbed",
                    "South Hindi Movies": "South Hindi",
                    "WEB-Series": "Web Series",
                    "Adult": "Adult"
                };

                const sections = { "Latest": [], "Trending": [] };
                const TRENDING_COUNT = 8;
                const hits = data.hits;

                async function enrichWithTMDB(doc) {
                    const title = doc.post_title || "Unknown";
                    let url = doc.permalink;
                    if (url && url.startsWith("/")) url = `${MAIN_URL}${url}`;
                    else if (url && !url.startsWith("http")) url = `${MAIN_URL}/${url}`;
                    url = normalizeSiteUrl(url);
                    const categories = Array.isArray(doc.category) ? doc.category : [doc.category || ""];
                    const isSeries = inferIsSeries(title, url, categories.join(" "));
                    const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
                    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
                    let bannerUrl, logoUrl;
                    try {
                        const tmdbId = await searchTMDBIdByTitle(title, !isSeries, year);
                        if (tmdbId) {
                            const details = await getTMDBDetails(tmdbId, isSeries ? "tv" : "movie");
                            if (details) {
                                bannerUrl = details.backdrop;
                                logoUrl = details.logoUrl;
                            }
                        }
                    } catch (_) {}
                    return new MultimediaItem({
                        title: title.replace(/\|.*$/, "").trim(),
                        url: url,
                        posterUrl: doc.post_thumbnail,
                        bannerUrl: bannerUrl,
                        logoUrl: logoUrl,
                        type: isSeries ? "series" : "movie",
                        contentType: isSeries ? "series" : "movie"
                    });
                }

                const trendingItems = await Promise.all(
                    hits.slice(0, TRENDING_COUNT).map(h => h.document ? enrichWithTMDB(h.document) : Promise.resolve(null))
                );
                sections["Trending"] = trendingItems.filter(Boolean);

                for (let i = TRENDING_COUNT; i < hits.length; i++) {
                    const doc = hits[i].document;
                    if (!doc) continue;
                    const title = doc.post_title || "Unknown";
                    let url = doc.permalink;
                    if (url && url.startsWith("/")) url = `${MAIN_URL}${url}`;
                    else if (url && !url.startsWith("http")) url = `${MAIN_URL}/${url}`;
                    url = normalizeSiteUrl(url);
                    const categories = Array.isArray(doc.category) ? doc.category : [doc.category || ""];
                    const isSeries = inferIsSeries(title, url, categories.join(" "));
                    const item = new MultimediaItem({
                        title: title.replace(/\|.*$/, "").trim(),
                        url: url,
                        posterUrl: doc.post_thumbnail,
                        type: isSeries ? "series" : "movie",
                        contentType: isSeries ? "series" : "movie"
                    });
                    sections["Latest"].push(item);
                    categories.forEach(cat => {
                        const sectionName = categoryMap[cat];
                        if (sectionName) {
                            if (!sections[sectionName]) sections[sectionName] = [];
                            sections[sectionName].push(item);
                        }
                    });
                }

                return cb({ success: true, data: sections });
            }

            cb({ success: true, data: scraped || {} });
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    }

    async function getTMDBDetails(tmdbId, mediaType) {
        const endpoint = mediaType === "tv" ? "tv" : "movie";
        const url = tmdbApi(`${endpoint}/${tmdbId}`, "append_to_response=external_ids,credits");
        const data = await fetchJson(url, { "Accept": "application/json" }, {});
        
        const actors = (data.credits?.cast || []).slice(0, 15).map(c => new Actor({
            name: c.name,
            image: c.profile_path ? `https://image.tmdb.org/t/p/w500${c.profile_path}` : null,
            role: c.character
        }));

        return {
            title: mediaType === "tv" ? data.name : data.title,
            year: (mediaType === "tv" ? data.first_air_date : data.release_date)?.split("-")[0],
            description: data.overview,
            poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : null,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            rating: data.vote_average,
            imdbId: data.external_ids?.imdb_id,
            logoUrl: data.external_ids?.imdb_id ? `https://live.metahub.space/logo/medium/${data.external_ids.imdb_id}/img` : null,
            cast: actors
        };
    }

    async function getTMDBSeasonEpisodes(tmdbId, seasonNumber) {
        try {
            const url = tmdbApi(`tv/${tmdbId}/season/${seasonNumber}`);
            const data = await fetchJson(url, { "Accept": "application/json" }, {});
            return (data.episodes || []).reduce((acc, ep) => {
                acc[ep.episode_number] = {
                    name: ep.name,
                    description: ep.overview,
                    posterUrl: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : null,
                    airDate: ep.air_date || null,
                    rating: Number.isFinite(Number(ep.vote_average)) && Number(ep.vote_average) > 0 ? Number(ep.vote_average) : null
                };
                return acc;
            }, {});
        } catch (e) {
            return {};
        }
    }

    function extractYearFromTitle(title) {
        const match = (title || "").match(/\b(19|20)\d{2}\b/);
        return match ? parseInt(match[0], 10) : null;
    }

    function normalizeLookupTitle(title, isMovie) {
        let clean = (title || "").replace(/\.[a-zA-Z0-9]{2,4}$/, "");
        clean = clean.replace(/\|.*$/, "");
        clean = clean.replace(/\[[^\]]*]/g, " ");
        clean = clean.replace(/\((?:Season|S)\s*\d+[^)]*\)/gi, " ");
        clean = clean.replace(/\b(?:Season|S)\s*\d+\b/gi, " ");
        clean = clean.replace(/\b(?:EP|Episode)\s*\d+\b/gi, " ");
        clean = clean.replace(/\b(?:WEB[- ]DL|WEB[- ]RIP|HDRIP|BLURAY|HDTC|HQ[- ]HDTC|DS4K|4K|2160p|1080p|720p|480p|10Bit|HEVC|x264|x265|HD|Dual Audio|Multi Audio|Hindi|English|Tamil|Telugu|Korean|Japanese|Spanish|PrimeVideo|Series|Movie|ALL)\b/gi, " ");
        if (!isMovie) {
            clean = clean.replace(/\b(?:Added|Episodes?)\b/gi, " ");
        }
        clean = clean.replace(/&/g, " ");
        clean = clean.replace(/[()[\]{}|,:;+/_-]+/g, " ");
        clean = clean.replace(/\b(?:and|org|all|dd(?:5\.1|2\.0)?)\b/gi, " ");
        return clean.replace(/\s+/g, " ").trim();
    }

    async function searchTMDBIdByTitle(title, isMovie, year) {
        let query = normalizeLookupTitle(title, isMovie);
        if (!query) return null;
        if (year) query = query.replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
        if (!query) return null;

        const endpoint = isMovie ? "movie" : "tv";
        const params = [`api_key=${TMDB_API_KEY}`, `query=${encodeURIComponent(query)}`];
        if (year) {
            params.push(isMovie ? `year=${year}` : `first_air_date_year=${year}`);
        }

        const url = tmdbApi(`search/${endpoint}`, params.join("&"));
        const data = await fetchJson(url, { "Accept": "application/json" }, {});
        const results = Array.isArray(data.results) ? data.results : [];
        if (!results.length) return null;

        const queryLc = query.toLowerCase();
        const scored = results.map(result => {
            const titleText = (isMovie ? result.title : result.name || "").toLowerCase();
            let score = 0;
            if (titleText === queryLc) score += 100;
            else if (titleText.includes(queryLc) || queryLc.includes(titleText)) score += 60;
            if (year) {
                const resultYear = parseInt(((isMovie ? result.release_date : result.first_air_date) || "").split("-")[0], 10);
                if (resultYear === year) score += 30;
            }
            score += result.popularity || 0;
            return { id: result.id, score };
        }).sort((a, b) => b.score - a.score);

        return scored[0]?.id || null;
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
            const titleYear = extractYearFromTitle(rawTitle);

            // Metadata Enrichment
            let tmdbData = null;
            let tmdbSeasonEpisodes = {};
            const imdbLink = doc.querySelector('a[href*="imdb.com"]')?.getAttribute('href');
            const tmdbLink = doc.querySelector('a[href*="themoviedb.org"]')?.getAttribute('href');
            const trailer = doc.querySelector('.responsive-embed-container > iframe:nth-child(1)')?.getAttribute('src')
                ?.replace("/embed/", "/watch?v=");
            const trailers = [makeTrailer(trailer)].filter(Boolean);
            const recommendations = parseRecommendations(doc, url);
            
            let tmdbId = null;
            let imdbId = extractImdbId(imdbLink);
            if (tmdbLink) {
                tmdbId = tmdbLink.split('/')[4]?.split('-')[0];
            } else if (imdbLink) {
                if (imdbId) {
                    const findUrl = tmdbApi(`find/${imdbId}`, "external_source=imdb_id");
                    const findData = await fetchJson(findUrl, { "Accept": "application/json" }, {});
                    tmdbId = isMovie ? findData.movie_results?.[0]?.id : findData.tv_results?.[0]?.id;
                }
            }

            if (tmdbId) {
                tmdbData = await getTMDBDetails(tmdbId, isMovie ? "movie" : "tv");
                if (!isMovie) {
                    tmdbSeasonEpisodes = await getTMDBSeasonEpisodes(tmdbId, seasonNumber);
                }
            } else {
                tmdbId = await searchTMDBIdByTitle(rawTitle, isMovie, titleYear);
                if (tmdbId) {
                    tmdbData = await getTMDBDetails(tmdbId, isMovie ? "movie" : "tv");
                    if (!isMovie) {
                        tmdbSeasonEpisodes = await getTMDBSeasonEpisodes(tmdbId, seasonNumber);
                    }
                }
            }
            imdbId = tmdbData?.imdbId || imdbId;

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
                logoUrl: tmdbData?.logoUrl || undefined,
                trailers: trailers.length ? trailers : undefined,
                recommendations: recommendations.length ? recommendations : undefined,
                syncData: buildSyncData(tmdbId, imdbId),
                type: isMovie ? "movie" : "series",
                contentType: isMovie ? "movie" : "series"
            });

            if (isMovie) {
                const content = doc.querySelector('.page-body') || doc.querySelector('main') || doc;
                const links = Array.from(content.querySelectorAll('a'))
                    .map(a => ({
                        text: a.textContent.trim(),
                        href: normalizeSiteUrl(a.getAttribute('href'))
                    }))
                    .filter(l => l.href && (l.href.includes("hdstream4u") || l.href.includes("hubstream") || l.text.match(/480|720|1080|2160|4k/i)) && !l.href.includes(MAIN_URL));
                
                item.episodes = [
                    new Episode({
                        name: "Play",
                        url: JSON.stringify(links.map(l => ({ url: l.href, name: l.text }))),
                        season: 1,
                        episode: 1,
                        posterUrl: tmdbData?.poster || poster
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
                        const elLinks = Array.from(el.querySelectorAll('a')).map(a => normalizeSiteUrl(a.getAttribute('href'))).filter(Boolean);
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
                            const link = normalizeSiteUrl(a.getAttribute('href'));
                            if (link && !link.includes(MAIN_URL)) {
                                try {
                                    const resolvedUrl = await withTimeout(getRedirectLinks(link), 8000, null);
                                    if (resolvedUrl) {
                                        const epRes = await http_get(resolvedUrl, { headers: HEADERS });
                                        const epDoc = await parseHtml(epRes.body);
                                        epDoc.querySelectorAll('h5 a, p a, a').forEach(aElement => {
                                            const epText = aElement.textContent;
                                            const epLink = normalizeSiteUrl(aElement.getAttribute('href'));
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
                        .map(a => normalizeSiteUrl(a.getAttribute('href')))
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
                        airDate: epInfo?.airDate,
                        rating: epInfo?.rating,
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

            // CloudStream-style: match s('o','{BASE64}') and ck('_wp_http_{digits}','{val}'), concatenate all
            const csRegex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let combined = "";
            let m;
            while ((m = csRegex.exec(doc)) !== null) {
                combined += m[1] || m[2] || "";
            }
            if (combined) console.log("HDHub4U: getRedirectLinks CS regex matched, combined len=" + combined.length);
            if (combined) {
                try {
                    const decoded = atob(atob(rot13(atob(combined))));
                    if (decoded.includes("{") || decoded.includes("[")) {
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
                } catch (_) {}
            }

            // Fallback: search for individual base64 tokens (older method)
            const allBase64 = doc.match(/[A-Za-z0-9+/=]{50,}/g) || [];
            for (const token of allBase64) {
                try {
                    const s1 = atob(atob(rot13(atob(token))));
                    if (s1.includes("{") || s1.includes("[")) {
                        console.log("HDHub4U: getRedirectLinks found VALID JSON in token len " + token.length);
                        const json = JSON.parse(s1);
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
                } catch (_) {}
            }

            // Fallback for anchors that might be the next step
            const doc2 = await parseHtml(doc);
            const anchors = doc2.querySelectorAll("a");
            for (const a of anchors) {
                const href = a.getAttribute("href") || "";
                if (href.includes("techyboy") || href.includes("gadgetsweb") || href.includes("cryptoinsights")) {
                    if (href !== url && !href.includes(url)) return await getRedirectLinks(href);
                }
            }

            // Fallback: follow JavaScript redirects (new gadgetsweb format uses window.location.href)
            const redirectUrls = [];
            const jsRedirectHref = doc.match(/window\.location\.href\s*=\s*['"]?([^'"\s;)]+)['"]?/);
            if (jsRedirectHref && jsRedirectHref[1].startsWith("http")) {
                redirectUrls.push(jsRedirectHref[1]);
            } else {
                // Try setTimeout-based redirects
                const timeoutMatch = doc.match(/(?:setTimeout|setInterval)\([^,]*['"]?([^'"\s;)]+\/['"]?)/);
                if (timeoutMatch && timeoutMatch[1].startsWith("http")) {
                    redirectUrls.push(timeoutMatch[1]);
                }
            }
            // Try meta refresh redirects
            const metaMatch = doc.match(/<meta[^>]*?url=['"]?([^'"\s>]+)/i);
            if (metaMatch && metaMatch[1].startsWith("http")) redirectUrls.push(metaMatch[1]);

            for (const redirectUrl of redirectUrls) {
                try {
                    console.log("HDHub4U: getRedirectLinks following JS redirect to: " + redirectUrl.substring(0, 100));
                    const followRes = await http_get(redirectUrl, { headers: HEADERS });
                    if (followRes && followRes.body) {
                        // Look for hubcloud/hubcdn/hubdrive URLs on the destination page
                        const hubMatch = followRes.body.match(/https?:\/\/(?:hubcloud|hubcdn|hubdrive)[^\s"'<>]+/i);
                        if (hubMatch) {
                            console.log("HDHub4U: getRedirectLinks found hubcloud link: " + hubMatch[0].substring(0, 80));
                            return hubMatch[0];
                        }
                        // Recursive: if destination has more JS redirects, follow them
                        const destRedirect = followRes.body.match(/window\.location\.href\s*=\s*['"]?([^'"\s;)]+)['"]?/);
                        if (destRedirect && destRedirect[1].startsWith("http")) {
                            return await getRedirectLinks(destRedirect[1]);
                        }
                    }
                } catch (_) {}
            }

            return null;
        } catch (e) {
            console.error("HDHub4U: getRedirectLinks Error: " + e.message);
            return null;
        }
    }

    async function hubCloudExtractor(url, referer) {
        console.log("HDHub4U: hubCloudExtractor for: " + url);
        try {
            let currentUrl = url;
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
            const qualityStr = header.match(/(\d{3,4})[pP]/)?.[1] || "";
            const headerDetails = cleanTitle(header);
            const labelExtras = (headerDetails ? `[${headerDetails}]` : "") + (size ? `[${size}]` : "");

            const links = [];
            const elements = Array.from($.querySelectorAll("a.btn, a.btn-lg, a.btn-primary, a.btn-success, a.btn-danger, button.btn"));
            console.log("HDHub4U: HubCloud found " + elements.length + " buttons");
            for (const element of elements) {
                let link = element.getAttribute("href");
                const text = element.textContent.toLowerCase();
                if (!link) {
                    const onclick = element.getAttribute("onclick") || "";
                    const onclickMatch = onclick.match(/location(?:\s*\.\s*href)?\s*=\s*['"]([^'"]+)['"]|window\.open\s*\(\s*['"]([^'"]+)['"]/i);
                    if (onclickMatch) link = onclickMatch[1] || onclickMatch[2];
                }
                if (!link || /telegram|facebook|twitter|tinyurl|tutorial/i.test(link + " " + text)) {
                    console.log("HDHub4U: HubCloud skipped button: text=[" + (text || "").substring(0, 40) + "] link=[" + (link || "null").substring(0, 40) + "]");
                    continue;
                }

                if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") || text.includes("fslv2") || text.includes("mega server") || text.includes("zipdisk")) {
                    let label = "HubCloud";
                    if (text.includes("fsl server")) label = "HubCloud [FSL]";
                    else if (text.includes("s3 server")) label = "HubCloud [S3]";
                    else if (text.includes("fslv2")) label = "HubCloud [FSLv2]";
                    else if (text.includes("mega server")) label = "HubCloud [Mega]";
                    else if (text.includes("zipdisk")) label = "HubCloud [ZipDisk]";
                    console.log("HDHub4U: HubCloud " + label + " -> " + link);
                    links.push(new StreamResult({
                        source: label,
                        name: `${label} ${labelExtras}`,
                        url: link,
                        quality: qualityStr,
                        size: size
                    }));
                } else if (text.includes("buzzserver")) {
                    console.log("HDHub4U: HubCloud BuzzServer -> " + link);
                    links.push(new StreamResult({
                        source: "BuzzServer",
                        name: `BuzzServer ${labelExtras}`,
                        url: link,
                        quality: qualityStr,
                        size: size
                    }));
                } else if (link && link.includes("pixeldra")) {
                    console.log("HDHub4U: HubCloud PixelDrain -> " + link);
                    links.push(new StreamResult({
                        source: "PixelDrain",
                        name: `PixelDrain ${labelExtras}`,
                        url: link.includes("?download") ? link : `https://pixeldrain.com/api/file/${link.split('/').pop()}?download`,
                        quality: qualityStr,
                        size: size
                    }));
                } else if (link && link.startsWith("http") && !link.includes("facebook.com") && !link.includes("twitter.com")) {
                    console.log("HDHub4U: HubCloud nested check: " + link + " text=" + text.substring(0, 40));
                    const extracted = await internalLoadExtractor(link, finalUrl);
                    links.push(...extracted.map(l => {
                        l.quality = l.quality || qualityStr || "1080p";
                        l.size = l.size || size;
                        return l;
                    }));
                } else {
                    console.log("HDHub4U: HubCloud unhandled button: text=[" + (text || "").substring(0, 40) + "] link=[" + (link || "null").substring(0, 40) + "]");
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
                const decoded = atob(encoded);
                const rawLink = decoded.includes("link=")
                    ? decoded.substring(decoded.lastIndexOf("link=") + 5)
                    : decoded;
                const m3u8Link = rawLink.trim();
                if (/^https?:\/\//i.test(m3u8Link)) {
                    // Extract quality from url if present (e.g. "480p⚡[860MB]")
                    const qualityStr = url.match(/[&?]q=(\d{3,4})|(\d{3,4})[pP]/i)?.[1] || "";
                    return [new StreamResult({ source: "HubCdn", url: m3u8Link, quality: qualityStr || "" })];
                }
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
            // CloudStream-style: specific button selector
            let href = doc.querySelector(".btn.btn-primary.btn-user.btn-success1.m-1")?.getAttribute("href");
            if (!href) {
                // Fallback: generic anchor search
                const anchors = Array.from(doc.querySelectorAll("a")).map(a => a.getAttribute("href")).filter(Boolean);
                href = anchors.find(h => /hubcloud|hubcdn|hubdrive|pixeldrain|streamtape|hdstream4u|hubstream/i.test(h));
            }
            if (href) {
                const finalHref = normalizeSiteUrl(href);
                if (finalHref.includes("hubcloud")) return await hubCloudExtractor(finalHref, url);
                return await internalLoadExtractor(finalHref, url);
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
            const contentRoot = doc.querySelector(".entry-content") || doc;
            const headingNodes = Array.from(contentRoot.querySelectorAll("h3, h5"));
            const candidateLinks = [];

            for (const heading of headingNodes) {
                const headingText = cleanTitle(heading.textContent || "").replace(/\s+/g, " ").trim();
                const qualityMatch = headingText.match(/(4K|2160p|1080p|720p|480p|360p)/i);
                const quality = qualityMatch ? qualityMatch[1] : "";
                const headingAnchors = Array.from(heading.querySelectorAll("a"))
                    .map(a => ({
                        href: normalizeSiteUrl(a.getAttribute("href")),
                        text: cleanTitle(a.textContent || "").trim()
                    }))
                    .filter(a => a.href);

                if (!headingAnchors.length) continue;

                const directAnchors = headingAnchors.filter(a => a.href.includes("hubcloud"));
                const instantAnchors = headingAnchors.filter(a => a.href.includes("hubcdn"));
                const watchAnchors = headingAnchors.filter(a => a.href.includes("hdstream4u") || a.href.includes("hubstream"));
                const fallbackAnchors = headingAnchors.filter(a => !a.href.includes("hubdrive"));

                const preferredAnchors = directAnchors.length
                    ? directAnchors
                    : instantAnchors.length
                        ? instantAnchors
                        : watchAnchors.length
                            ? watchAnchors
                            : fallbackAnchors;

                for (const anchor of preferredAnchors) {
                    candidateLinks.push({
                        href: anchor.href,
                        quality,
                        label: headingText || anchor.text || "Download"
                    });
                }
            }

            const fallbackLinks = candidateLinks.length ? [] : Array.from(doc.querySelectorAll("h3 a, h5 a, div.entry-content p a"))
                .map(a => ({
                    href: normalizeSiteUrl(a.getAttribute("href")),
                    quality: "",
                    label: cleanTitle(a.textContent || "").trim()
                }))
                .filter(a => a.href && !a.href.includes("hubdrive"));

            const links = (candidateLinks.length ? candidateLinks : fallbackLinks).filter(item => item.href);
            const uniqueLinks = [];
            const seenLinks = new Set();
            for (const item of links) {
                if (seenLinks.has(item.href)) continue;
                seenLinks.add(item.href);
                uniqueLinks.push(item);
            }

            const results = await mapLimit(uniqueLinks, 5, async (item) => {
                const extracted = await withTimeout(internalLoadExtractor(item.href, url), 5000, []);
                return extracted.map(stream => {
                    if (item.quality && (!stream.quality || stream.quality === "Unknown")) {
                        stream.quality = item.quality;
                    }
                    if (item.label && stream.source && !stream.source.includes(item.quality || "")) {
                        const qualityPart = item.quality ? ` - ${item.quality}` : "";
                        stream.source = `${stream.source}${qualityPart}`;
                    }
                    return stream;
                });
            });
            return results.flat();
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

    async function hdStream4uExtractor(url, referer = MAIN_URL) {
        try {
            // Extract file_code from URL like https://hdstream4u.com/file/jvvq9iql1moy
            const fileCode = url.split("/file/").pop().split("/")[0].split("?")[0];
            if (!fileCode) {
                console.log("HDHub4U: HdStream4u could not parse file_code from: " + url);
                return [new StreamResult({ source: "HdStream4u", url: url })];
            }

            const embedUrl = `https://morencius.com/embed/${fileCode}`;
            console.log(`HDHub4U: HdStream4u fetching embed: ${embedUrl}`);

            const response = await http_get(embedUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                    "Referer": url
                }
            });

            const html = response.body || "";

            // Find and decode the Dean Edwards packed JavaScript
            // Format: eval(function(p,a,c,k,e,d){...}('ENCODED',RADIX,COUNT,'DICT'.split('|')))
            var packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[^]*?}\('(.+?)',(\d+),(\d+),'([^']+)'\.split\('\|'\)/);
            if (packedMatch) {
                var pEncoded = packedMatch[1];
                var radix = parseInt(packedMatch[2]);
                var count = parseInt(packedMatch[3]);
                var dict = packedMatch[4].split("|");

                // Dean Edwards packer decoder
                function decodePacked(str, base, cnt, words) {
                    while (cnt--) {
                        if (words[cnt]) {
                            str = str.replace(new RegExp("\\b" + cnt.toString(base) + "\\b", "g"), words[cnt]);
                        }
                    }
                    return str;
                }

                var decoded = decodePacked(pEncoded, radix, count, dict);

                // Extract relative stream URL (hls4 - morencius internal CDN)
                var hls4Match = decoded.match(/\/stream\/[^"']+/);
                if (hls4Match) {
                    var streamUrl = "https://morencius.com" + hls4Match[0];
                    console.log("HDHub4U: HdStream4u extracted hls4: " + streamUrl.substring(0, 80) + "...");
                    return [new StreamResult({
                        source: "HdStream4u",
                        url: streamUrl,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                            "Referer": embedUrl
                        }
                    })];
                }

                // Fallback: extract absolute acek-cdn HLS URL (hls2)
                var hls2Match = decoded.match(/https:\/\/[^"']+acek-cdn[^"']*master\.m3u8[^"']*/);
                if (hls2Match) {
                    var acekUrl = hls2Match[0];
                    console.log("HDHub4U: HdStream4u extracted acek-cdn hls2: " + acekUrl.substring(0, 80) + "...");
                    return [new StreamResult({
                        source: "HdStream4u",
                        url: acekUrl,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                            "Referer": embedUrl
                        }
                    })];
                }
            }

            // Final fallback: return raw URL (current behavior)
            console.log("HDHub4U: HdStream4u no video found in embed, returning raw URL");
            return [new StreamResult({ source: "HdStream4u", url: url })];
        } catch (e) {
            console.error(`HDHub4U: HdStream4u extractor error: ${e.message}`);
            return [new StreamResult({ source: "HdStream4u", url: url })];
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
                    let cleanRes = normalizeSiteUrl(res.trim());
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
                return await hdStream4uExtractor(url, referer);
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
            
            const extractedGroups = await mapLimit(uniqueLinks, 5, async (lObj) => {
                try {
                    const lUrl = normalizeSiteUrl(lObj.url);
                    const lName = lObj.name || "";
                    const streams = await withTimeout(internalLoadExtractor(lUrl), 8000, []);

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
                    });

                    return streams;
                } catch (e) {
                    console.error("HDHub4U: Extraction error for " + lObj.url + ": " + e.message);
                    return [];
                }
            });

            allResults.push(...extractedGroups.flat());

            console.log("HDHub4U: Total streams before dedup: " + allResults.length);
            allResults.forEach((r, i) => console.log("HDHub4U:   pre-dedup[" + i + "] source=" + r.source + " url=" + (r.url || "").substring(0, 60)));

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

    async function testEndpoints(cb) {
        const RESULTS = {};
        const HEADERS2 = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
            "Cookie": "xla=s4t",
            "Referer": `${MAIN_URL}/`
        };
        const tests = [
            { name: "WP-API", url: "https://new1.hdhub4u.limo/wp-json/wp/v2/posts?per_page=10" },
            { name: "HTTP", url: "http://new1.hdhub4u.limo/" },
            { name: "RSS", url: "https://new1.hdhub4u.limo/feed/" },
            { name: "Sitemap", url: "https://new1.hdhub4u.limo/wp-sitemap.xml" },
            { name: "MoviePage", url: "https://new1.hdhub4u.limo/hoppers-2026-hindi-webrip-full-movie/" }
        ];
        for (const t of tests) {
            try {
                const res = await http_get(t.url, { headers: HEADERS2 });
                RESULTS[t.name] = { status: res.status, bodyLen: res.body?.length };
                if (res.body) {
                    RESULTS[t.name].hasContent = res.body.includes("recent-movies") || res.body.includes("post-title") || res.body.includes("hoppers");
                }
            } catch (e) {
                RESULTS[t.name] = { error: e.message };
            }
        }
        cb({ success: true, data: RESULTS });
    }

    const plugin = {
        search: search,
        getHome: getHome,
        load: load,
        loadStreams: loadStreams,
        testEndpoints: testEndpoints
    };

    // Export to globalThis for skystream test
    globalThis.search = search;
    globalThis.getHome = getHome;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    globalThis.testEndpoints = testEndpoints;
})();
