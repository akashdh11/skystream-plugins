(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const tmdbApi = "https://divine-darkness-fad4.phisher13.workers.dev";
    const tmdbImageBase = "https://image.tmdb.org/t/p/original";
    const commonHeaders = {
        "x-auth-token": "7297skkihkajwnsgaklakshuwd",
        "x-requested-with": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    };
    const externalHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36" };

    const fixUrl = u => !u ? "" : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? manifest.baseUrl + u : u;
    const decodeHtml = h => !h ? "" : h.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");

    const getQuality = t => {
        if (!t) return "Auto"; t = t.toLowerCase();
        if (t.includes("2160p") || t.includes("4k")) return "4K";
        if (t.includes("1080p")) return "1080p";
        if (t.includes("720p")) return "720p";
        if (t.includes("480p")) return "480p";
        if (t.includes("360p")) return "360p";
        return "Auto";
    };

    async function extractPixelDrain(url) {
        const id = /\/u\/([a-zA-Z0-9]+)/.exec(url)?.[1];
        return id ? [{ url: `https://pixeldrain.com/api/file/${id}?download`, name: "PixelDrain", quality: getQuality(url) }] : [];
    }

    async function extractStreamTape(url, referer) {
        const h = Object.assign({}, externalHeaders); if (referer) h.Referer = referer;
        const res = await http_get(url, h);
        if (res.status !== 200) return [];
        const rob = /getElementById\('robotlink'\)\.innerHTML\s*=\s*'([^']+)'/.exec(res.body)?.[1];
        return rob ? [{ url: rob.startsWith("//") ? "https:" + rob : rob, name: "StreamTape", quality: getQuality(url) }] : [];
    }

    async function extractBuzzServer(url, referer) {
        const h = Object.assign({}, externalHeaders); if (referer) h.Referer = referer || url;
        const res = await http_get(url.endsWith("/") ? url + "download" : url + "/download", h);
        const l = res.headers?.["hx-redirect"] || res.headers?.["HX-Redirect"] || res.headers?.["location"];
        return l ? [{ url: l, name: "BuzzServer", quality: getQuality(url) }] : [];
    }

    async function extractHubCloud(url, referer, originalQuality) {
        const res = await http_get(url, externalHeaders);
        if (res.status !== 200) return [];
        const html = res.body, hMatch = /<div[^>]+class=["']card-header["'][^>]*>([\s\S]*?)<\/div>/.exec(html);
        let q = hMatch ? getQuality(decodeHtml(hMatch[1]).trim()) : originalQuality;
        if (q === "Auto") q = originalQuality;
        const bRegex = /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*btn[^"']*["'][^>]*>([\s\S]*?)<\/a>/g;
        let m, ops = [], out = [];
        while ((m = bRegex.exec(html)) !== null) {
            const h = fixUrl(m[1].trim()), t = decodeHtml(m[2].replace(/<[^>]+>/g, "").trim()).toLowerCase();
            if (t.includes("fsl server") || t.includes("fslv2")) out.push({ url: h, name: "FSL Server", quality: q });
            else if (t.includes("download file")) out.push({ url: h, name: "HubCloud", quality: q });
            else if (t.includes("s3 server")) out.push({ url: h, name: "S3 Server", quality: q });
            else if (t.includes("mega server")) out.push({ url: h, name: "Mega Server", quality: q });
            else if (t.includes("10gbps")) out.push({ url: h, name: "10Gbps Server", quality: q });
            else if (t.includes("pixeldra") || t.includes("pixelserver") || t.includes("pixel server")) ops.push(extractPixelDrain(h).then(l => out.push(...l)));
            else if (t.includes("buzzserver")) ops.push(extractBuzzServer(h, url).then(l => out.push(...l)));
            else if (t.includes("streamtape")) ops.push(extractStreamTape(h, url).then(l => out.push(...l)));
        }
        await Promise.all(ops);
        return out;
    }

    async function resolveExtractor(url, quality) {
        if (!url) return [];
        if (url.includes("hubcloud") || url.includes("gamerxyt") || url.includes("hub.") || url.includes("fsl")) {
            return (await extractHubCloud(url, "", quality)).map(r => new StreamResult({ name: "XD " + r.name, url: r.url, quality: r.quality || quality, headers: externalHeaders }));
        }
        if (url.includes("pixeldrain")) return (await extractPixelDrain(url)).map(r => new StreamResult({ name: "XD " + r.name, url: r.url, quality: quality, headers: externalHeaders }));
        if (url.includes("streamtape")) return (await extractStreamTape(url, "")).map(r => new StreamResult({ name: "XD " + r.name, url: r.url, quality: quality, headers: externalHeaders }));
        if (url.includes("buzz")) return (await extractBuzzServer(url, "")).map(r => new StreamResult({ name: "XD " + r.name, url: r.url, quality: quality, headers: externalHeaders }));
        if (url.includes("dood")) return [new StreamResult({ name: "DoodStream", url: url, quality: quality, headers: externalHeaders })];
        if (url.includes("drive") || url.includes("gdrive")) return [new StreamResult({ name: "GDrive", url: url, quality: quality, headers: externalHeaders })];
        return [];
    }

    async function getHome(cb) {
        try {
            const cats = [{ t: "Homepage", u: "" }, { t: "Netflix", u: "category.php?ott=Netflix" }, { t: "Amazon Prime", u: "category.php?ott=Amazon" }, { t: "Disney+", u: "category.php?ott=DisneyPlus" }, { t: "HBO Max", u: "category.php?ott=HBOMax" }, { t: "Hulu", u: "category.php?ott=Hulu" }, { t: "Zee5", u: "category.php?ott=Zee5" }, { t: "Hotstar", u: "category.php?ott=JioHotstar" }];
            const results = {};
            await Promise.all(cats.map(async c => {
                const fetch = async p => {
                    const sep = c.u.includes("?") ? "&" : "?", res = await http_get(`${manifest.baseUrl}/${c.u}${sep}page=${p}`, commonHeaders);
                    if (res.status !== 200) return [];
                    const items = [], aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
                    let m; while ((m = aRegex.exec(res.body)) !== null) {
                        const h = m[1], content = m[2], tMatch = /<h3>([^<]+)<\/h3>/i.exec(content);
                        const title = tMatch ? decodeHtml(tMatch[1].trim()) : "";
                        let poster = ""; const img = /<img[^>]+>/i.exec(content);
                        if (img) { const sMatch = /\s(?:data-)?src=["']([^"']+)["']/i.exec(img[0]); if (sMatch) poster = fixUrl(sMatch[1]); }
                        if (title && poster && !h.includes("javascript")) {
                            const type = h.includes("/tv/") || h.includes("/series/") ? "series" : "movie";
                            items.push(new MultimediaItem({ title, url: fixUrl(h), posterUrl: poster, type }));
                        }
                    }
                    return items;
                };
                const p1 = await fetch(1);
                const unique = [], seen = new Set();
                p1.forEach(i => { if (!seen.has(i.url)) { seen.add(i.url); unique.push(i); } });
                if (unique.length > 0) results[c.t] = unique;
            }));
            cb({ success: true, data: results });
        } catch (e) { cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message }); }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(`${manifest.baseUrl}/php/search_api.php?query=${encodeURIComponent(query)}&fuzzy=true`, commonHeaders);
            if (res.status !== 200) return cb({ success: true, data: [] });
            const json = JSON.parse(res.body);
            cb({ success: true, data: json.map(i => {
                const type = i.type.toLowerCase() === 'tv' || i.type.toLowerCase() === 'series' ? "series" : "movie";
                return new MultimediaItem({ title: decodeHtml(i.title), url: manifest.baseUrl + i.path, posterUrl: tmdbImageBase + i.poster, description: i.type, type });
            }) });
        } catch { cb({ success: true, data: [] }); }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, externalHeaders);
            if (res.status !== 200) return cb({ success: false, errorCode: "SITE_OFFLINE" });
            const html = res.body, title = decodeHtml(/<h2>([^<]+)<\/h2>/.exec(html)?.[1]?.trim() || "Unknown"), poster = fixUrl(/div[^>]+class=["']details-wrapper["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/.exec(html)?.[1]), description = decodeHtml(/<p[^>]+class=["']overview["'][^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim()), isTv = url.includes("/tv/") || url.includes("/series/") || url.includes("/anime/");
            
            if (!isTv) {
                const mLinks = [], dlRegex = /<div[^>]+class=["'][^"']*download-item[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
                let m; while ((m = dlRegex.exec(html)) !== null) if (!m[1].includes("javascript")) mLinks.push({ url: fixUrl(m[1].trim()), name: decodeHtml(m[2].replace(/<[^>]+>/g, "").trim()) });
                if (mLinks.length === 0) { const bRegex = /<a[^>]+class=["'][^"']*download-button[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g; while ((m = bRegex.exec(html)) !== null) mLinks.push({ url: fixUrl(m[1].trim()), name: decodeHtml(m[2].trim()) }); }
                
                cb({ success: true, data: new MultimediaItem({ 
                    title, url, posterUrl: poster, description, type: "movie", 
                    episodes: [new Episode({ name: "Full Movie", season: 1, episode: 1, url: JSON.stringify(mLinks), posterUrl: poster })] 
                }) });
            } else {
                const epMap = {}, sects = html.split('class="season-section"');
                for (let i = 1; i < sects.length; i++) {
                    const sect = sects[i], sNum = parseInt(/season-(?:packs|episodes)-(\d+)/.exec(sect)?.[1] || /Season\s*(\d+)/i.exec(sect)?.[1] || 1), cards = sect.split('class="episode-card"');
                    for (let j = 1; j < cards.length; j++) {
                        const ch = cards[j], et = decodeHtml(/class=["']episode-title["']>([^<]+)<\/div>/.exec(ch)?.[1]?.trim() || `Episode ${j}`), en = parseInt(/E(\d+)/i.exec(et)?.[1] || j), eLinks = [], lRegex = /<a[^>]+(?:class=["'][^"']*(?:movie-download-btn|download-button)[^"']*["'])[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g, lRegex2 = /<a[^>]+href=["']([^"']+)["'][^>]+(?:class=["'][^"']*(?:movie-download-btn|download-button)[^"']*["'])[^>]*>([\s\S]*?)<\/a>/g;
                        let l; const qp = /(\d{3,4}p)/i.exec(et)?.[1] ? /(\d{3,4}p)/i.exec(et)[1] + " " : "";
                        while ((l = lRegex.exec(ch)) !== null) if (!l[1].includes("javascript")) eLinks.push({ url: fixUrl(l[1].trim()), name: qp + decodeHtml(l[2].replace(/<[^>]+>/g, "").trim()) });
                        while ((l = lRegex2.exec(ch)) !== null) if (!l[1].includes("javascript") && !eLinks.some(x => x.url === fixUrl(l[1].trim()))) eLinks.push({ url: fixUrl(l[1].trim()), name: qp + decodeHtml(l[2].replace(/<[^>]+>/g, "").trim()) });
                        if (eLinks.length) { 
                            const k = `${sNum}_${en}`; 
                            if (!epMap[k]) epMap[k] = new Episode({ name: `S${sNum} E${en}`, season: sNum, episode: en, posterUrl: poster, url: "" }); 
                            epMap[k].url = JSON.stringify(eLinks); // We use the JSON string of links as the URL for extraction in loadStreams
                        }
                    }
                }
                cb({ success: true, data: new MultimediaItem({ title, url, posterUrl: poster, description, type: "series", episodes: Object.values(epMap) }) });
            }
        } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR", message: e.message }); }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const data = JSON.parse(dataStr), links = [];
            await Promise.all(data.map(async it => {
                const u = it.url, q = getQuality(it.name);
                if (u.includes("xdmovies") || u.includes("/links/") || u.includes("hubcloud") || u.includes("gamerxyt")) {
                    const res = await http_get(u, u.includes("xdmovies") ? commonHeaders : externalHeaders);
                    if (res.status === 200) {
                        const html = res.body, aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g; let m, ops = [];
                        while ((m = aRegex.exec(html)) !== null) {
                            const f = m[1], t = m[2].toLowerCase();
                            if (["winexch", "bet", "casino", "facebook", "twitter", "tinyurl", "telegram"].some(d => f.includes(d)) || !f.startsWith("http") || ["tutorial", "how to", "advertise", "account", "login"].some(x => t.includes(x))) continue;
                            const lq = getQuality(t) === "Auto" ? q : getQuality(t);
                            ops.push(resolveExtractor(f, lq).then(ex => links.push(...ex)));
                        }
                        if (!ops.length) links.push(...(await resolveExtractor(u, q))); else await Promise.all(ops);
                    } else links.push(...(await resolveExtractor(u, q)));
                } else links.push(...(await resolveExtractor(u, q)));
            }));
            cb({ success: true, data: links });
        } catch { cb({ success: true, data: [] }); }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
