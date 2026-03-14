(function() {
    async function getHome(cb) {
        try {
            const html = await http_get("https://www.1tamilmv.army/index.php");
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const homeData = {};
            
            // Helper to extract basic movie links from a section
            const extractSectionLinks = (titleText, selector) => {
                const headers = doc.querySelectorAll('h2.ipsType_sectionTitle');
                let targetHeader = null;
                for (const h of headers) {
                    if (h.textContent.toUpperCase().includes(titleText.toUpperCase())) {
                        targetHeader = h;
                        break;
                    }
                }
                
                if (!targetHeader) return [];
                
                // The IPS structure usually has the content in the next ipsBox container or similar sibling
                const container = targetHeader.closest('.ipsBox');
                if (!container) return [];
                
                const links = container.querySelectorAll('.ipsPad a');
                const items = [];
                for (const link of links) {
                    const title = link.textContent.trim();
                    const url = link.getAttribute('href');
                    if (title && url && url.includes('topic')) {
                        items.push(new MultimediaItem({
                            title: title,
                            url: url,
                            posterUrl: "https://placehold.co/400x600.png?text=" + encodeURIComponent(title.substring(0, 20)),
                            type: "movie"
                        }));
                    }
                }
                return items;
            };

            // 1. Top Releases This Week
            homeData["Top Releases This Week"] = extractSectionLinks("TOP RELEASES THIS WEEK");
            
            // 2. Recently Added
            homeData["Recently Added"] = extractSectionLinks("RECENTLY ADDED");

            // 3. Weekly Releases (Sidebar)
            const sidebarWidget = doc.querySelector('.ipsWidget[data-blocktitle="Week Releases"], h3.ipsWidget_title');
            if (sidebarWidget) {
                // If we found the title, find the container
                const widgetContainer = sidebarWidget.closest('.ipsWidget');
                if (widgetContainer) {
                    const topics = widgetContainer.querySelectorAll('li.ipsDataItem h4.ipsDataItem_title a');
                    const items = [];
                    for (const topic of topics) {
                        const title = topic.textContent.trim();
                        const url = topic.getAttribute('href');
                        if (title && url) {
                            items.push(new MultimediaItem({
                                title: title,
                                url: url,
                                posterUrl: "https://placehold.co/400x600.png?text=" + encodeURIComponent(title.substring(0, 20)),
                                type: "movie"
                            }));
                        }
                    }
                    homeData["Weekly Releases"] = items;
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
