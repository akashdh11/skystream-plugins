(function() {
    async function getHome(cb) {
        try {
            const html = await http_get("https://www.1tamilmv.army/index.php");
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const homeData = {};
            
            // Helper to extract basic movie links from a section
            const extractSectionLinks = (titleText) => {
                // Try to find the section by text content in headers
                const allElements = doc.querySelectorAll('h2, .shimmer-text, .ipsType_sectionTitle, .banger-header');
                let targetHeader = null;
                for (const el of allElements) {
                    if (el.textContent.toUpperCase().includes(titleText.toUpperCase())) {
                        targetHeader = el;
                        break;
                    }
                }
                
                if (!targetHeader) return [];
                
                // The content is usually in the same ipsBox or the next sibling ipsPad
                const container = targetHeader.closest('.ipsBox') || targetHeader.parentElement;
                if (!container) return [];
                
                // For Top Releases, links are often direct children of an ipsPad or in spans
                const links = container.querySelectorAll('a');
                const items = [];
                for (const link of links) {
                    const title = link.textContent.trim();
                    const url = link.getAttribute('href');
                    // Filter for topic links and avoid metadata links (like tags/authors)
                    if (title && url && url.includes('topic') && !url.includes('profile') && title.length > 10) {
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
            const sidebarTitles = doc.querySelectorAll('.ipsWidget_title');
            let weekWidget = null;
            for (const t of sidebarTitles) {
                if (t.textContent.includes("Week Releases") || t.textContent.includes("Weekly Releases")) {
                    weekWidget = t.closest('.ipsWidget');
                    break;
                }
            }

            if (weekWidget) {
                const topics = weekWidget.querySelectorAll('li.ipsDataItem h4.ipsDataItem_title a');
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
