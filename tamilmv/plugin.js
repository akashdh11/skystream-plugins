(function() {
    async function getHome(cb) {
        try {
            const categories = [
                { name: "Tamil", url: "https://www.1tamilmv.army/index.php?/forums/forum/9-tamil-language/" },
                { name: "Malayalam", url: "https://www.1tamilmv.army/index.php?/forums/forum/34-malayalam-language/" },
                { name: "Telugu", url: "https://www.1tamilmv.army/index.php?/forums/forum/22-telugu-language/" },
                { name: "Hindi", url: "https://www.1tamilmv.army/index.php?/forums/forum/56-hindi-language/" },
                { name: "English", url: "https://www.1tamilmv.army/index.php?/forums/forum/45-english-language/" }
            ];

            const homeData = {};
            
            // For getHome, we'll just fetch the first few topics from each category page
            // to populate the horizontal rows.
            for (const cat of categories) {
                const html = await http_get(cat.url);
                const dom = new JSDOM(html);
                const doc = dom.window.document;
                
                const topics = doc.querySelectorAll('.ipsDataItem_title a');
                const items = [];
                
                for (let i = 0; i < Math.min(topics.length, 12); i++) {
                    const topic = topics[i];
                    const title = topic.textContent.trim();
                    const url = topic.getAttribute('href');
                    
                    if (title && url) {
                        items.push(new MultimediaItem({
                            title: title,
                            url: url,
                            // Thumbnails are not available on forum list, use placeholder
                            posterUrl: "https://placehold.co/400x600.png?text=" + encodeURIComponent(title.substring(0, 20)),
                            type: "movie"
                        }));
                    }
                }
                
                if (items.length > 0) {
                    homeData[cat.name] = items;
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.toString() });
        }
    }

    async function search(query, page, cb) {
        try {
            // TamilMV search URL
            const searchUrl = `https://www.1tamilmv.army/index.php?/search/&q=${encodeURIComponent(query)}&quicksearch=1&search_and_or=and&sortby=relevancy`;
            const html = await http_get(searchUrl);
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const results = doc.querySelectorAll('.ipsStreamItem_title a');
            const items = [];
            
            for (const res of results) {
                const title = res.textContent.trim();
                const url = res.getAttribute('href');
                
                if (title && url) {
                    items.push(new MultimediaItem({
                        title: title,
                        url: url,
                        posterUrl: "https://placehold.co/400x600.png?text=" + encodeURIComponent(title.substring(0, 20)),
                        type: "movie"
                    }));
                }
            }
            
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.toString() });
        }
    }

    async function load(url, cb) {
        try {
            const html = await http_get(url);
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const title = doc.querySelector('.ipsType_pageTitle')?.textContent?.trim() || "Unknown Title";
            
            // Extract the first large image from the post as poster
            const posterImg = doc.querySelector('.ipsType_normal img.ipsImage');
            const posterUrl = posterImg ? posterImg.getAttribute('src') : "";
            
            const description = doc.querySelector('.ipsType_normal')?.textContent?.trim() || "";
            
            // Extract magnet links inside the post
            const links = doc.querySelectorAll('a');
            const magnetLinks = [];
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('magnet:')) {
                    const magnetName = link.textContent.trim() || title;
                    magnetLinks.push(new StreamResult({
                        url: href,
                        source: magnetName.includes('GB') ? magnetName.split('GB')[0] + 'GB' : magnetName
                    }));
                }
            }
            
            const item = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: posterUrl || "https://placehold.co/400x600.png?text=" + encodeURIComponent(title.substring(0, 20)),
                description: description,
                type: "movie",
                vpnStatus: "torrent", // Mark as torrent to trigger VPN warning
                streams: magnetLinks // Instant Load: Provide magnets directly
            });
            
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.toString() });
        }
    }

    async function loadStreams(url, cb) {
        // Since we already provide streams in 'load' for Instant Load, 
        // this is mostly for redundancy or if 'load' didn't provide them.
        try {
            const html = await http_get(url);
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const links = doc.querySelectorAll('a');
            const streams = [];
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('magnet:')) {
                    streams.push(new StreamResult({
                        url: href,
                        source: link.textContent.trim() || "Magnet"
                    }));
                }
                // Support .torrent files if needed, but magnet is preferred for Instant Load
            }
            
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.toString() });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
