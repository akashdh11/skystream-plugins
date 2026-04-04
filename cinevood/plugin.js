(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const cinemetaUrl = "https://v3-cinemeta.strem.io/meta";
    const externalHeaders = { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" 
    };

    const fixUrl = function(u, base) { 
        if (!u) return ""; 
        if (u.startsWith("//")) return "https:" + u;
        if (u.startsWith("/")) return (base || manifest.baseUrl) + u;
        return u;
    };
    const decodeHtml = function(h) { return !h ? "" : h.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)); };

    const getQuality = function(t) {
        if (!t) return "Auto"; t = t.toLowerCase();
        if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1) return "2160p";
        if (t.indexOf("1080") !== -1) return "1080p";
        if (t.indexOf("720") !== -1) return "720p";
        if (t.indexOf("480") !== -1) return "480p";
        if (t.indexOf("360") !== -1) return "360p";
        if (t.indexOf("webrip") !== -1 || t.indexOf("web-dl") !== -1 || t.indexOf("web") !== -1) return "WebRip";
        if (t.indexOf("bluray") !== -1) return "BlueRay";
        if (t.indexOf("hdts") !== -1 || t.indexOf("hdcam") !== -1 || t.indexOf("hdtc") !== -1) return "HdCam";
        if (t.indexOf("dvd") !== -1) return "DVD";
        if (t.indexOf("camrip") !== -1 || t.indexOf("rip") !== -1) return "CamRip";
        if (t.indexOf("cam") !== -1) return "Cam";
        if (t.indexOf("hdrip") !== -1 || t.indexOf("hdtv") !== -1) return "HD";
        if (t.indexOf("hq") !== -1) return "HQ";
        
        const m = /(\d{3,4})[pP]/.exec(t);
        if (m) return m[1] + "p";
        return "Auto";
    };

    const toResult = function(node) {
        const titleLink = node.querySelector("h2.title a") || node.querySelector("h3.entry-title a") || node.querySelector("a");
        if (!titleLink) return null;
        const title = decodeHtml(titleLink.textContent || titleLink.getAttribute("title") || "").trim();
        const url = fixUrl(titleLink.getAttribute("href"));
        const img = node.querySelector("img.wp-post-image") || node.querySelector("img.attachment-featured-content") || node.querySelector("img");
        const posterUrl = img ? fixUrl(img.getAttribute("data-src") || img.getAttribute("src")) : "";
        const quality = getQuality(title);
        return new MultimediaItem({ title: title, url: url, posterUrl: posterUrl, type: "movie", quality: quality });
    };

    async function getHome(cb) {
        try {
            const sections = [
                { name: "Trending", path: "" },
                { name: "Bollywood", path: "bollywood/" },
                { name: "Hollywood", path: "hollywood/" },
                { name: "Gujarati", path: "gujarati/" },
                { name: "Marathi", path: "marathi/" },
                { name: "Tamil", path: "tamil/" }
            ];
            const results = {};
            for (let i = 0; i < sections.length; i++) {
                const s = sections[i];
                const res = await http_get(manifest.baseUrl + s.path, externalHeaders);
                if (res.status === 200) {
                    const html = await parseHtml(res.body);
                    const items = Array.from(html.querySelectorAll("article.latestPost")).map(toResult).filter(Boolean);
                    if (items.length > 0) results[s.name] = items;
                }
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(manifest.baseUrl + "?s=" + encodeURIComponent(query), externalHeaders);
            if (res.status !== 200) return cb({ success: true, data: [] });
            const html = await parseHtml(res.body);
            cb({ success: true, data: Array.from(html.querySelectorAll("article.latestPost")).map(toResult).filter(Boolean) });
        } catch (e) {
            cb({ success: true, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, externalHeaders);
            if (res.status !== 200) return cb({ success: false, errorCode: "SITE_OFFLINE" });
            const html = await parseHtml(res.body);

            let imdbId = null;
            const imdbNode = html.querySelector("a[href*='imdb.com/title/']");
            if (imdbNode) {
                const href = imdbNode.getAttribute("href");
                const m = /title\/(tt\d+)/.exec(href);
                if (m) imdbId = m[1];
            }

            const h1Title = html.querySelector("h1.title") || html.querySelector("h1") || html.querySelector("h2.title");
            const ogTitle = html.querySelector("meta[property='og:title']");
            let title = h1Title ? h1Title.textContent.trim() : (ogTitle ? ogTitle.getAttribute("content") : "Untitled");
            title = title.replace("Download ", "").trim();
            
            // Try to find quality in the entire page body if not in title
            let bodyQuality = getQuality(title);
            if (bodyQuality === "Auto") {
                bodyQuality = getQuality(res.body);
            }
            const summaryNode = html.querySelector("span#summary");
            let description = summaryNode ? summaryNode.textContent.replace("Summary:", "").trim() : "";
            const ogImage = html.querySelector("meta[property='og:image']");
            let posterUrl = ogImage ? ogImage.getAttribute("content") : "";
            let backgroundUrl = posterUrl;
            let type = /(series|S\d{2})/i.test(title) ? "series" : "movie";

            let cast = [], genre = [], score = 0, year = null;

            if (imdbId) {
                const cinemetaType = (type === "series") ? "series" : "movie";
                const cmRes = await http_get(cinemetaUrl + "/" + cinemetaType + "/" + imdbId + ".json", externalHeaders);
                if (cmRes.status === 200) {
                    const cmResponse = JSON.parse(cmRes.body);
                    const cmData = cmResponse ? cmResponse.meta : null;
                    if (cmData) {
                        title = cmData.name || title;
                        description = cmData.description || description;
                        posterUrl = cmData.poster || posterUrl;
                        backgroundUrl = cmData.background || backgroundUrl;
                        cast = cmData.cast || [];
                        genre = cmData.genre || [];
                        score = parseFloat(cmData.imdbRating) || 0;
                        year = parseInt(cmData.releaseInfo) || null;
                    }
                }
            }

            const seasonMatch = /S(\d{2})/i.exec(title);
            const extractedSeason = seasonMatch ? seasonMatch[0].toUpperCase() : null;
            if (type === "series" && extractedSeason && title.indexOf(extractedSeason) === -1) {
                title = title.trim() + " " + extractedSeason;
            }

            // Link Identification
            const oxxfileNodes = html.querySelectorAll("a[href*='oxxfile']");
            const bubblyNodes = html.querySelectorAll("a.bubbly-button");
            
            // Regex Extraction Fallback for obfuscated/minified links
            const bodyLinks = [];
            const linkRegex = /href=["']([^"']*(?:oxxfile|hubcloud|link|download|1cinevood)[^"']*)["']/gi;
            let m;
            while ((m = linkRegex.exec(res.body)) !== null) {
                const h = fixUrl(m[1].trim());
                if (h.indexOf("tag") === -1 && h.indexOf("category") === -1 && h !== manifest.baseUrl && (h.indexOf("/link/") !== -1 || h.indexOf("/p/") !== -1 || h.indexOf("oxxfile") !== -1 || h.indexOf("hubcloud") !== -1)) {
                    bodyLinks.push(h);
                }
            }

            const isSeries = title.toLowerCase().indexOf("season") !== -1 || title.toLowerCase().indexOf("series") !== -1 || title.toLowerCase().indexOf("complete") !== -1 || Array.from(oxxfileNodes).concat(Array.from(bubblyNodes)).some(function(n) {
                const href = n.getAttribute("href");
                return href && href.indexOf("/p/") !== -1;
            });
            const multiType = isSeries ? "series" : "movie";

            if (!isSeries) {
                // Primary extraction: Look for mirrors in the main content area/selectors
                let links = Array.from(oxxfileNodes).concat(Array.from(bubblyNodes)).map(function(n) { return n.getAttribute("href"); }).filter(Boolean);
                
                function isGoodLink(l) {
                    if (!l) return false;
                    const h = l.toLowerCase();
                    return h.indexOf("oxxfile") !== -1 || h.indexOf("hubcloud") !== -1 || h.indexOf("/link/") !== -1;
                }

                links = links.filter(isGoodLink);
                
                if (links.length === 0) {
                    links = Array.from(html.querySelectorAll("a[href*='hubcloud']")).map(function(n) { return n.getAttribute("href"); }).filter(isGoodLink);
                }

                const currentBase = new URL(url).origin + "/";

                // Fallback 1: Try centralized redirector if we found a post ID
                if (links.length === 0) {
                    const postMatch = /postid-(\d+)/.exec(res.body) || /p=(\d+)/.exec(res.body);
                    if (postMatch) {
                        const redirectorUrl = currentBase + "link/" + postMatch[1] + "/";
                        const redRes = await http_get(redirectorUrl, externalHeaders);
                        if (redRes.status === 200) {
                            let redM;
                            while ((redM = linkRegex.exec(redRes.body)) !== null) {
                                const h = fixUrl(redM[1].trim());
                                if (isGoodLink(h)) {
                                    links.push(h);
                                }
                            }
                        }
                    }
                }

                // Fallback 2: Try /api/packs/ for movies too (sometimes used for multi-quality)
                if (links.length === 0) {
                    const slug = url.split("/").filter(Boolean).pop();
                    const packUrl = currentBase + "api/packs/?slug=" + slug;
                    const packRes = await http_get(packUrl, externalHeaders);
                    if (packRes.status === 200 && packRes.body && packRes.body.trim().indexOf("{") === 0) {
                        try {
                            const packData = JSON.parse(packRes.body);
                            if (packData && packData.success && packData.data) {
                                for (let entry of packData.data) {
                                    if (entry.links) {
                                        for (let l of entry.links) {
                                            if (l.url && isGoodLink(l.url)) links.push(fixUrl(l.url));
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }

                // Final safety: if STILL empty, use the aggressive body links filter
                if (links.length === 0) {
                    links = bodyLinks.filter(isGoodLink);
                }

                const uniqueLinks = links.filter(function(v, i, a) { return a.indexOf(v) === i; });
                const data = new MultimediaItem({
                    title: title, url: url, posterUrl: posterUrl, type: "movie",
                    description: description, score: score, year: year, bannerUrl: backgroundUrl,
                    cast: cast.map(function(c) { return new Actor({ name: c }); }),
                    episodes: [new Episode({ 
                        name: "Full Movie", season: 1, episode: 1, 
                        url: JSON.stringify({ title: title, links: uniqueLinks, bodyQuality: bodyQuality }) 
                    })]
                });
                cb({ success: true, data: data });
            } else {
                let epLinksData = [];
                const slug = url.split("/").filter(Boolean).pop();
                const currentBase = new URL(url).origin + "/";
                const packUrl = currentBase + "api/packs/?slug=" + slug;
                const packRes = await http_get(packUrl, externalHeaders);
                
                if (packRes.status === 200 && packRes.body && packRes.body.trim().indexOf("{") === 0) {
                    try {
                        const packData = JSON.parse(packRes.body);
                        if (packData && packData.success && packData.data) {
                            for (let entry of packData.data) {
                                if (entry.links) {
                                    const mappedItems = entry.links.map(function(l) {
                                        return { title: l.title || "Mirror", link: fixUrl(l.url) };
                                    });
                                    epLinksData.push(mappedItems);
                                }
                            }
                        }
                    } catch (e) {}
                }

                if (epLinksData.length === 0) {
                    const packNodes = Array.from(oxxfileNodes).filter(function(n) { 
                        const href = n.getAttribute("href");
                        return href && href.indexOf("/p/") !== -1; 
                    });

                    for (let i = 0; i < packNodes.length; i++) {
                        const href = packNodes[i].getAttribute("href");
                        const apiRes = await http_get(href.replace("/p/", "/api/packs/"), externalHeaders);
                        if (apiRes.status === 200 && apiRes.body && apiRes.body.trim().indexOf("{") === 0) {
                            try {
                                const json = JSON.parse(apiRes.body);
                                const items = (json && json.pack) ? (json.pack.items || []) : [];
                                epLinksData.push(items.map(function(it) {
                                    return { title: it.episode_name || it.file_name || "EP", link: it.hubcloud_link || "" };
                                }));
                            } catch (e) {}
                        }
                    }
                }

                const episodes = [];
                const maxEpisodes = epLinksData.length > 0 ? Math.max.apply(null, epLinksData.map(function(c) { return c.length; })) : 0;
                for (let i = 0; i < maxEpisodes; i++) {
                    const epLinks = epLinksData.map(function(c) { return c[i] ? c[i].link : null; }).filter(Boolean);
                    if (epLinks.length === 0) continue;
                    const firstEp = epLinksData.find(function(c) { return c[i]; });
                    const epTitle = firstEp ? firstEp[i].title : "Episode " + (i + 1);
                    episodes.push(new Episode({
                        name: epTitle,
                        season: 1,
                        episode: i + 1,
                        url: JSON.stringify({ title: title + " - " + epTitle, links: epLinks, bodyQuality: bodyQuality })
                    }));
                }

                const data = new MultimediaItem({
                    title: title, url: url, posterUrl: posterUrl, type: "series",
                    description: description, score: score, year: year, bannerUrl: backgroundUrl,
                    cast: cast.map(function(c) { return new Actor({ name: c }); }),
                    episodes: episodes
                });
                cb({ success: true, data: data });
            }
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }



    async function resolveHubCloud(initialUrl, fallbackText) {
        let currentUrl = initialUrl;
        let lastUrl = initialUrl;
        let maxTries = 4;
        const results = [];

        while (maxTries-- > 0) {
            const headers = JSON.parse(JSON.stringify(externalHeaders));
            headers["Referer"] = lastUrl;
            
            const res = await http_get(currentUrl, headers);
            if (res.status !== 200) break;
            
            lastUrl = currentUrl;
            const body = res.body;

            // Check if we hit a final direct video server early
            if (currentUrl.indexOf(".mkv") !== -1 || currentUrl.indexOf(".mp4") !== -1) {
                results.push(new StreamResult({
                    url: currentUrl, name: "Cinevood Mirror", headers: externalHeaders
                }));
                return results;
            }

            // Case 1: We found "FSL" or "Direct" buttons (Final Stage)
            const bRegex = /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*btn[^"']*["'][^>]*>([\s\S]*?)<\/a>/g;
            let m;
            let foundFinal = false;
            while ((m = bRegex.exec(body)) !== null) {
                const h = fixUrl(m[1].trim());
                const t = decodeHtml(m[2].replace(/<[^>]+>/g, "").trim()).toLowerCase();
                if (t.indexOf("fsl") !== -1 || t.indexOf("download") !== -1 || t.indexOf("10gbps") !== -1 || t.indexOf("direct") !== -1 || t.indexOf("server") !== -1) {
                    const qualityText = t + " " + h.split("/").pop() + " " + (fallbackText || "");
                    const qRes = getQuality(qualityText);
                    const cleanT = t.replace(/download|file|server|\[|\]|\(|\)/gi, "").replace(/\s+/g, " ").trim().toUpperCase();
                    const finalLabel = "HubCloud " + (qRes !== "Auto" ? qRes : "").trim() + (cleanT ? " (" + cleanT + ")" : "");
                    
                    results.push(new StreamResult({
                        url: h,
                        source: finalLabel.replace(/\s+/g, " ").trim(),
                        headers: externalHeaders
                    }));
                    foundFinal = true;
                }
            }

            if (foundFinal) return results;

            // Case 2: We found a redirector for HubCloud (Stage 2)
            const redirectMatch = /var url = '([^']+)'/i.exec(body) || /window\.location\.href = "([^"]+)"/i.exec(body);
            if (redirectMatch) {
                currentUrl = fixUrl(redirectMatch[1]);
                continue;
            }

            // Case 3: We are on a landing page with a primary "Digital" or "HubCloud" button
            const landingMatch = /href=["']([^"']*(?:hubcloud|oxvvfile|video)[^"']*)["'][^>]*class=["'][^"']*btn[^"']*["']/i.exec(body);
            if (landingMatch) {
                const nextUrl = fixUrl(landingMatch[1]);
                if (nextUrl !== currentUrl) {
                    currentUrl = nextUrl;
                    continue;
                }
            }
            break;
        }
        return results;
    }

    async function loadStreams(dataStr, cb) {
        try {
            const payload = JSON.parse(dataStr);
            const title = payload.title || "";
            const bQuality = payload.bodyQuality || "Auto";
            const links = payload.links || (Array.isArray(payload) ? payload : [payload]);
            let results = [];
            
            for (let i = 0; i < links.length; i++) {
                let u = links[i];
                if (typeof u !== "string") continue;
                try {
                    const headers = JSON.parse(JSON.stringify(externalHeaders));
                    // Handle OxxFile -> HubCloud Chain
                    if (u.indexOf("oxxfile") !== -1) {
                        const apiUrl = u.replace("/s/", "/api/s/") + "/hubcloud";
                        const apiRes = await http_get(apiUrl, headers);
                        if (apiRes.status === 200) {
                            const varUrlMatch = /var url = '([^']+)'/i.exec(apiRes.body);
                            if (varUrlMatch) u = fixUrl(varUrlMatch[1], new URL(u).origin);
                        }
                    }

                    // Resolve HubCloud / Redirector
                    if (u.indexOf("hubcloud") !== -1 || u.indexOf("oxvvfile") !== -1 || u.indexOf("hub.") !== -1 || u.indexOf("/link/") !== -1 || u.indexOf("php?") !== -1) {
                        const hResults = await resolveHubCloud(u, title + " " + bQuality);
                        results = results.concat(hResults);
                    } else if (u.indexOf("http") === 0 && (u.indexOf(".mkv") !== -1 || u.indexOf(".mp4") !== -1)) {
                        const qRes = getQuality(u.split("/").pop() + " " + title + " " + bQuality);
                        const finalLabel = "Cinevood " + (qRes !== "Auto" ? qRes : "Direct");
                        
                        results.push(new StreamResult({
                            url: u,
                            source: finalLabel.trim(),
                            headers: externalHeaders
                        }));
                    }
                } catch (err) {
                    console.error("Stream extraction failed for: " + u, err);
                }
            }
            
            // Deduplicate streams
            const uniqueResults = [];
            const seenUrls = new Set();
            for (let r of results) {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    uniqueResults.push(r);
                }
            }
            
            cb({ success: true, data: uniqueResults });
        } catch (e) {
            cb({ success: true, data: [] });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
