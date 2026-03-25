(function () {
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

let cachedMainUrl = null;

async function getMainUrl() {
    if (cachedMainUrl) return cachedMainUrl;
    try {
        const res = await http_get(DOMAINS_URL);
        const data = JSON.parse(res.body);
        cachedMainUrl = data.hindmoviez || "https://hindmoviez.cafe";
    } catch (e) {
        cachedMainUrl = "https://hindmoviez.cafe";
    }
    return cachedMainUrl;
}

function cleanTitle(raw) {
    if (!raw) return "Unknown";
    return raw
        .replace(/\b(480p|720p|1080p|4K|HDRip|BluRay|WEBRip|WEB-DL|DVDRip|HEVC|x264|x265|AAC|DD5\.1|ESub)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function stripTags(str) {
    if (!str) return "";
    return str.replace(/<[^>]*>/g, "").trim();
}

function resolveUrl(href, base) {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return base.replace(/\/$/, "") + href;
    return base.replace(/\/$/, "") + "/" + href;
}

function parseArticles(html, mainUrl) {
    const items = [];
    const articleRe = /<article[^]*?<\/article>/gi;
    let articleMatch;
    while ((articleMatch = articleRe.exec(html)) !== null) {
        const block = articleMatch[0];

        const titleMatch = block.match(/<h2[^>]*class="entry-title"[^>]*>[^]*?<a[^>]*>([^]*?)<\/a>/i);
        const rawTitle = titleMatch ? stripTags(titleMatch[1]) : null;
        if (!rawTitle) continue;

        const hrefMatch = block.match(/<a[^>]+href="([^"]+)"/i);
        const href = hrefMatch ? resolveUrl(hrefMatch[1], mainUrl) : null;
        if (!href) continue;

        const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
        const poster = imgMatch ? imgMatch[1] : null;

        items.push(new MultimediaItem({
            title: cleanTitle(rawTitle),
            url: href,
            posterUrl: poster,
            type: "movie"
        }));
    }
    return items;
}

async function getHome(cb) {
    try {
        const mainUrl = await getMainUrl();
        const res = await http_get(mainUrl);
        const items = parseArticles(res.body, mainUrl);

        cb({ success: true, data: { "Trending": items } });
    } catch (e) {
        cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
    }
}

async function search(query, cb) {
    try {
        const mainUrl = await getMainUrl();
        const res = await http_get(`${mainUrl}/?s=${encodeURIComponent(query)}`);
        const items = parseArticles(res.body, mainUrl);
        cb({ success: true, data: items });
    } catch (e) {
        cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
    }
}

async function load(url, cb) {
    try {
        const res = await http_get(url);
        const html = res.body;

        const titleMatch = html.match(/<h1[^>]*>([^]*?)<\/h1>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : "Unknown";

        const posterMatch = html.match(/og:image" content="([^"]+)"/i);
        const poster = posterMatch ? posterMatch[1] : null;

        const links = [];
        const maxbuttonRe = /<a[^>]+class="[^"]*maxbutton[^"]*"[^>]+href="([^"]+)"/gi;
        let match;

        while ((match = maxbuttonRe.exec(html)) !== null) {
            links.push(match[1]);
        }

        cb({
            success: true,
            data: new MultimediaItem({
                title,
                url: JSON.stringify(links),
                posterUrl: poster,
                type: "movie"
            })
        });

    } catch (e) {
        cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
    }
}

// ---------- BASE64 DECODER ----------
function decodeBase64Id(url) {
    try {
        const match = url.match(/id=([^&]+)/);
        if (!match) return "";
        const base64 = match[1];
        return atob(base64);
    } catch {
        return "";
    }
}

// ---------- QUALITY ----------
function getQuality(str) {
    const s = str.toLowerCase();
    if (/4k|2160/.test(s)) return 2160;
    if (/1080/.test(s)) return 1080;
    if (/720/.test(s)) return 720;
    if (/480/.test(s)) return 480;
    if (/360/.test(s)) return 360;
    if (/hd/.test(s)) return 720;
    if (/cam|ts/.test(s)) return 360;
    return 0;
}

// ---------- SIZE ----------
function getSize(str) {
    const m = str.match(/(\d+(\.\d+)?)\s*(gb|mb)/i);
    if (!m) return "";
    return `${m[1]}${m[3].toUpperCase()}`;
}

// ---------- STREAMS ----------
async function loadStreams(url, cb) {
    try {
        const links = JSON.parse(url);
        const results = [];
        const seen = new Set();

        for (const pageUrl of links) {
            let res;
            try {
                res = await http_get(pageUrl);
            } catch {
                continue;
            }

            const matches = res.body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi);

            for (const m of matches) {
                const finalUrl = m[1];
                if (!finalUrl || !finalUrl.startsWith("http")) continue;

                // FILTER JUNK
                if (
                    finalUrl.includes("telegram") ||
                    finalUrl.includes("linkskit") ||
                    finalUrl.endsWith("/web/")
                ) continue;

                if (seen.has(finalUrl)) continue;
                seen.add(finalUrl);

                const decodedName = decodeBase64Id(finalUrl);
                const combined = decodedName.toLowerCase();

                const quality = getQuality(combined);
                const size = getSize(combined);

                let label = "Auto";
                if (quality && size) label = `${quality}p (${size})`;
                else if (quality) label = `${quality}p`;
                else if (size) label = `Auto (${size})`;

                results.push(new StreamResult({
                    url: finalUrl,
                    quality,
                    source: label,
                    headers: { Referer: pageUrl }
                }));
            }
        }

        results.sort((a, b) => (b.quality || 0) - (a.quality || 0));

        cb({ success: true, data: results });

    } catch (e) {
        cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
    }
}

globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
globalThis.loadStreams = loadStreams;

})();
