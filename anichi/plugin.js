(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    // --- Constants ---
    const API_URL = "https://api.allanime.day/api";
    const HEADERS = {
        "app-version": "android_c-247",
        "from-app": "allmanga",
        "platformstr": "android_c",
        "Referer": "https://allmanga.to",
        "Content-Type": "application/json"
    };

    const HASHES = {
        main: "e42a4466d984b2c0a2cecae5dd13aa68867f634b16ee0f17b380047d14482406",
        popular: "31a117653812a2547fd981632e8c99fa8bf8a75c4ef1a77a1567ef1741a7ab9c",
        detail: "bb263f91e5bdd048c1c978f324613aeccdfe2cbc694a419466a31edb58c0cc0b",
        server: "5f1a64b73793cc2234a389cf3a8f93ad82de7043017dd551f38f65b89daa65e0",
        mainPage: "06327bc10dd682e1ee7e07b6db9c16e9ad2fd56c1b769e47513128cd5c9fc77a"
    };

    // --- Settings ---
    registerSettings([
        { id: "translation_type", name: "Translation Type", type: "select", options: ["sub", "dub"], default: "sub" },
        { id: "quality", name: "Preferred Quality", type: "select", options: ["1080p", "720p", "480p", "360p"], default: "1080p" }
    ]);

    // --- Helpers ---
    async function queryGraph(variables, hash) {
        const body = {
            variables: variables,
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: hash
                }
            }
        };
        
        try {
            const res = await http_post(API_URL, HEADERS, JSON.stringify(body));
            if (!res || res.trim().startsWith("<")) {
               throw new Error("HTTP_BLOCK: Cloudflare or Network Error (HTML returned)");
            }
            return JSON.parse(res);
        } catch (e) {
            console.error("GraphQL Error: " + e.message);
            throw e;
        }
    }

    function toMultimediaItem(edge) {
        if (!edge) return null;
        const thumbnail = edge.thumbnail || edge.anyCard?.thumbnail || "";
        const posterUrl = thumbnail.startsWith("http") 
            ? thumbnail 
            : thumbnail ? `https://wp.youtube-anime.com/aln.youtube-anime.com/${thumbnail}` : "";

        const name = edge.name || edge.englishName || edge.nativeName || edge.anyCard?.name || "Unknown";

        return new MultimediaItem({
            title: name,
            url: edge._id, // Store ID as URL
            posterUrl: posterUrl,
            type: edge.type?.toLowerCase().includes("movie") ? "movie" : "anime",
            year: edge.airedStart?.year,
            description: edge.description?.replace(/<[^>]*>/g, ""),
            headers: HEADERS
        });
    }

    // --- Core Functions ---

    async function getHome(cb) {
        try {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const season = month <= 3 ? "Winter" : month <= 6 ? "Spring" : month <= 9 ? "Summer" : "Fall";
            const transType = getPreference("translation_type") || "sub";

            const categories = {
                "New Series": { search: { season, year }, translationType: transType, countryOrigin: "ALL" },
                "Latest Anime": { search: {}, translationType: transType, countryOrigin: "ALL" },
                "Latest Donghua": { search: {}, translationType: transType, countryOrigin: "CN" },
                "Movies": { search: { types: ["Movie"] }, translationType: transType, countryOrigin: "ALL" }
            };

            let homeData = {};

            // Fetch standard categories
            for (const [name, variables] of Object.entries(categories)) {
                try {
                    const res = await queryGraph({ ...variables, limit: 26, page: 1 }, HASHES.mainPage);
                    const items = res.data?.shows?.edges?.map(toMultimediaItem).filter(i => i) || [];
                    if (items.length > 0) homeData[name] = items;
                } catch (err) {
                    console.error(`Failed to load category ${name}: ${err.message}`);
                }
            }

            // Fetch Popular (different hash and structure)
            try {
                const popularRes = await queryGraph({ type: "anime", size: 30, dateRange: 1, page: 1, allowAdult: true, allowUnknown: false }, HASHES.popular);
                const popularItems = popularRes.data?.queryPopular?.recommendations?.map(r => toMultimediaItem(r))?.filter(i => i) || [];
                if (popularItems.length > 0) homeData["Trending"] = popularItems;
            } catch (err) {
                console.error(`Failed to load Trending: ${err.message}`);
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, page, cb) {
        try {
            const transType = getPreference("translation_type") || "sub";
            const variables = {
                search: { query: query },
                limit: 26,
                page: page,
                translationType: transType,
                countryOrigin: "ALL"
            };

            const res = await queryGraph(variables, HASHES.mainPage);
            const items = res.data?.shows?.edges?.map(toMultimediaItem) || [];
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function getAniListMedia(title, year, season, type) {
        const query = `
        query ($search: String, $type: MediaType, $season: MediaSeason, $year: String, $format: [MediaFormat]) {
          Page(page: 1, perPage: 1) {
            media(search: $search, type: $type, season: $season, startDate_like: $year, format_in: $format) {
              id idMal bannerImage
              coverImage { extraLarge large medium }
              title { english romaji native }
              startDate { year }
              genres description averageScore status
              nextAiringEpisode { episode }
              recommendations { edges { node { id mediaRecommendation { id title { english romaji } coverImage { large } } } } }
            }
          }
        }`;
        
        const variables = {
            search: title,
            type: "ANIME",
            season: type?.toLowerCase() === "ona" ? undefined : season?.toUpperCase(),
            year: year ? `${year}%` : undefined,
            format: [type?.toUpperCase()]
        };

        const res = await http_post("https://graphql.anilist.co", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, variables })
        });
        const data = JSON.parse(res);
        return data.data?.Page?.media?.[0];
    }

    async function getTmdbLogo(tmdbId, type) {
        if (!tmdbId) return null;
        const apiKey = "98ae14df2b8d8f8f8136499daf79f0e0";
        const url = `https://api.themoviedb.org/3/${type === "movie" ? "movie" : "tv"}/${tmdbId}/images?api_key=${apiKey}`;
        try {
            const res = await http_get(url);
            const data = JSON.parse(res);
            const logos = data.logos || [];
            if (logos.length === 0) return null;
            // Prefer English
            const logo = logos.find(l => l.iso_639_1 === "en") || logos[0];
            return `https://image.tmdb.org/t/p/w500${logo.file_path}`;
        } catch (e) {
            return null;
        }
    }

    async function getAniZipData(malId) {
        if (!malId) return null;
        try {
            const res = await http_get(`https://api.ani.zip/mappings?mal_id=${malId}`);
            return JSON.parse(res);
        } catch (e) {
            return null;
        }
    }

    async function load(url, cb) {
        try {
            const res = await queryGraph({ _id: url }, HASHES.detail);
            const show = res.data?.show;
            if (!show) return cb({ success: false, message: "Show not found" });

            const title = show.name;
            const year = show.airedStart?.year;
            const season = show.season?.quarter;
            const type = show.type;

            // Fetch extra metadata in parallel
            const [aniMedia, aniZip] = await Promise.all([
                getAniListMedia(title, year, season, type) || getAniListMedia(show.altNames?.[0], year, season, type),
                show.idMal ? getAniZipData(show.idMal) : Promise.resolve(null)
            ]);

            const tmdbId = aniZip?.mappings?.themoviedb_id;
            const logoUrl = await getTmdbLogo(tmdbId, show.type?.toLowerCase().includes("movie") ? "movie" : "tv");

            const episodes = (show.availableEpisodesDetail?.sub || []).map(epNum => {
                const aniEp = aniZip?.episodes?.[epNum];
                return new Episode({
                    name: aniEp?.title?.en || aniEp?.title?.ja || `Episode ${epNum}`,
                    url: JSON.stringify({ hash: show._id, dubStatus: "sub", episode: epNum, idMal: show.idMal }),
                    season: 1,
                    episode: parseInt(epNum),
                    description: aniEp?.overview || "No summary available",
                    posterUrl: aniEp?.image || toMultimediaItem(show).posterUrl,
                    runtime: aniEp?.runtime,
                    headers: HEADERS
                });
            });

            // Handle DUB episodes if available
            const dubEpisodes = (show.availableEpisodesDetail?.dub || []).map(epNum => {
                const aniEp = aniZip?.episodes?.[epNum];
                return new Episode({
                    name: aniEp?.title?.en || aniEp?.title?.ja || `Episode ${epNum} (Dub)`,
                    url: JSON.stringify({ hash: show._id, dubStatus: "dub", episode: epNum, idMal: show.idMal }),
                    season: 1,
                    episode: parseInt(epNum),
                    description: aniEp?.overview || "No summary available",
                    posterUrl: aniEp?.image || toMultimediaItem(show).posterUrl,
                    runtime: aniEp?.runtime,
                    headers: HEADERS
                });
            });

            const recommendations = show.relatedShows?.map(r => toMultimediaItem(r)) || [];

            const result = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: toMultimediaItem(show).posterUrl,
                bannerUrl: aniMedia?.bannerImage || show.banner,
                logoUrl: logoUrl,
                type: show.type?.toLowerCase().includes("movie") ? "movie" : "anime",
                description: show.description?.replace(/<[^>]*>/g, ""),
                year: year,
                score: show.averageScore / 10,
                status: show.status?.toLowerCase() === "releasing" ? "ongoing" : "completed",
                genres: show.genres,
                tags: show.tags,
                contentRating: show.rating,
                duration: show.episodeDuration ? Math.floor(show.episodeDuration / 60000) : undefined,
                cast: (show.characters || []).map(c => new Actor({
                    name: c.name?.full || c.name?.native,
                    role: c.role,
                    image: c.image?.large || c.image?.medium
                })),
                trailers: (show.prevideos || []).filter(v => v).map(v => new Trailer({
                    name: "Trailer",
                    url: `https://www.youtube.com/watch?v=${v}`
                })),
                episodes: episodes,
                recommendations: recommendations,
                headers: HEADERS
            });

            // If we have DUB episodes, we might want to expose them. 
            // In SkyStream, we usually combine them or let user choose.
            // For now, let's just use SUB episodes as default but store both in manifest if needed.
            // Actually, the app logic handles sub/dub via the url payload we created.
            if (dubEpisodes.length > 0) {
                // We add dub episodes to the end or interleaved?
                // Standard: the provider handles it.
                result.episodes = episodes.concat(dubEpisodes);
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    function decryptHex(hex) {
        if (!hex) return "";
        const cleanHex = hex.startsWith("-") ? hex.split("-").pop() : hex;
        let str = "";
        for (let i = 0; i < cleanHex.length; i += 2) {
            const byte = parseInt(cleanHex.substring(i, i + 2), 16);
            str += String.fromCharCode(byte ^ 56);
        }
        return str;
    }

    async function loadStreams(url, cb) {
        try {
            const data = JSON.parse(url);
            const variables = {
                showId: data.hash,
                translationType: data.dubStatus,
                episodeString: data.episode.toString()
            };

            const res = await queryGraph(variables, HASHES.server);
            const sources = res.data?.episode?.sourceUrls || [];

            const streamResults = [];

            for (const source of sources) {
                let rawLink = source.sourceUrl;
                if (!rawLink) continue;

                // 1. Decrypt if hex
                let link = rawLink.startsWith("--") ? decryptHex(rawLink) : rawLink;

                // 2. Handle Ak / player embeds (base64)
                if (source.sourceName === "Ak" || link.includes("/player/vitemb")) {
                    try {
                        const b64 = link.split("=").pop();
                        const decoded = JSON.parse(atob(b64));
                        link = decoded.idUrl;
                    } catch (e) {
                        // fallback to original link
                    }
                }

                // 3. Resolve internal JSON sources
                if (link.includes(".json?") || link.includes("apivtwo/clock.json")) {
                    try {
                        const jsonRes = await http_get(link, { headers: HEADERS });
                        const videoData = JSON.parse(jsonRes);
                        const links = videoData.links || [];
                        links.forEach(l => {
                            streamResults.push(new StreamResult({
                                url: l.link,
                                source: `AllAnime - ${source.sourceName} (${l.resolutionStr})`,
                                headers: { ...HEADERS, "Referer": "https://allmanga.to" }
                            }));
                        });
                    } catch (e) {
                        // ignore error
                    }
                } else if (link.startsWith("http")) {
                    // Standard extractor link
                    streamResults.push(new StreamResult({
                        url: link,
                        source: `AllAnime - ${source.sourceName}`,
                        headers: HEADERS
                    }));
                }
            }

            cb({ success: true, data: streamResults });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // Export
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
