(() => {
    'use strict';

    // Cache DOM nodes
    const urlField = document.getElementById('urlField');
    const searchForm = document.getElementById('searchForm');
    const messageEl = document.getElementById('message');
    const resultEl = document.getElementById('result');

    const MP3_MIME_TYPES = new Set(['audio/mp3', 'audio/mpeg', 'audio/mpeg3']);
    const MP4_MIME_TYPES = new Set(['video/mp4']);

    /**
     * Clears all child nodes of the target element.
     * @param {HTMLElement} element The element to be cleared.
     */
    const clearElement = (element) => {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    };

    /**
     * Extracts the first URL found in the provided text using RegEx.
     * @param {string} text
     * @returns {string|null} Matched URL or null
     */
    const extractUrlFromText = (text) => {
        const urlPattern = /(https?:\/\/\S+)/i;
        const match = text.match(urlPattern);
        return match ? match[0] : null;
    };

    /**
     * Decodes common HTML entities in attribute values.
     * @param {string} value
     * @returns {string}
     */
    const decodeHtmlEntities = (value) => {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = value;
        return textarea.value;
    };

    /**
     * Resolves a possibly relative URL against the page URL.
     * @param {string} candidate
     * @param {string} baseUrl
     * @returns {string|null}
     */
    const resolveMediaUrl = (candidate, baseUrl) => {
        if (!candidate) {
            return null;
        }

        const cleaned = decodeHtmlEntities(candidate.trim());
        if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:')) {
            return null;
        }

        try {
            return new URL(cleaned, baseUrl).href;
        } catch {
            return null;
        }
    };

    const isMp3Link = (url) => {
        try {
            return new URL(url).pathname.toLowerCase().endsWith('.mp3');
        } catch {
            return false;
        }
    };

    const isMp4Link = (url) => {
        try {
            return new URL(url).pathname.toLowerCase().endsWith('.mp4');
        } catch {
            return false;
        }
    };

    /**
     * @param {Set<string>} urls
     * @param {string|null} candidate
     * @param {string} baseUrl
     * @param {(url: string) => boolean} matcher
     */
    const addMediaUrl = (urls, candidate, baseUrl, matcher) => {
        const resolved = resolveMediaUrl(candidate, baseUrl);
        if (resolved && matcher(resolved)) {
            urls.add(resolved);
        }
    };

    /**
     * @param {string} text
     * @returns {boolean}
     */
    const looksLikeHtml = (text) => {
        const trimmed = text.trim();
        if (!trimmed) {
            return false;
        }

        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            return false;
        }

        return /<!doctype html|<html[\s>]|<body[\s>]|<audio[\s>]|<video[\s>]/i.test(trimmed);
    };

    /**
     * Fetches page HTML through a proxy, trying same-origin first then public fallbacks.
     * @param {string} pageUrl
     * @returns {Promise<string>}
     */
    const fetchPageHtml = async (pageUrl) => {
        const encodedUrl = encodeURIComponent(pageUrl);
        const proxies = [
            {
                name: 'same-origin',
                buildUrl: () => {
                    const proxyUrl = new URL('proxy', window.location.href);
                    proxyUrl.search = `url=${pageUrl}`;
                    return proxyUrl.href;
                },
                parseResponse: (text) => text,
            },
            {
                name: 'corsproxy.io',
                buildUrl: () => `https://corsproxy.io/?url=${encodedUrl}`,
                parseResponse: (text) => text,
            },
            {
                name: 'allorigins',
                buildUrl: () => `https://api.allorigins.win/get?url=${encodedUrl}`,
                parseResponse: (text) => {
                    const payload = JSON.parse(text);
                    if (!payload.contents) {
                        throw new Error('allorigins response did not include page contents');
                    }
                    return payload.contents;
                },
            },
            {
                name: 'codetabs',
                buildUrl: () => `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
                parseResponse: (text) => text,
            },
        ];

        const errors = [];

        for (const proxy of proxies) {
            try {
                const response = await fetch(proxy.buildUrl(), {mode: 'cors'});
                const rawResponse = await response.text();

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const html = proxy.parseResponse(rawResponse);

                if (!looksLikeHtml(html)) {
                    throw new Error('response did not look like HTML');
                }

                return html;
            } catch (error) {
                errors.push(`${proxy.name}: ${error.message}`);
                console.warn(`Fetch proxy "${proxy.name}" failed`, error);
            }
        }

        throw new Error(`Could not fetch page HTML. ${errors.join(' | ')}`);
    };

    /**
     * Finds direct media URLs embedded in raw HTML or script content.
     * @param {string} rawHtml
     * @param {string} baseUrl
     * @returns {Set<string>}
     */
    const findMediaLinksInText = (rawHtml, baseUrl) => {
        const urls = new Set();
        const patterns = [
            {regex: /https?:\/\/[^\s"'<>\\]+\.mp3\b/gi, matcher: isMp3Link},
            {regex: /https?:\/\/[^\s"'<>\\]+\.mp4\b/gi, matcher: isMp4Link},
        ];

        patterns.forEach(({regex, matcher}) => {
            const matches = rawHtml.match(regex) || [];
            matches.forEach((match) => addMediaUrl(urls, match, baseUrl, matcher));
        });

        return urls;
    };

    /**
     * Finds media links in the provided document by checking for audio/video elements and data attributes.
     * @param {Document} doc
     * @param {string} rawHtml
     * @param {string} baseUrl
     * @returns {string[]} Array of media file URLs.
     */
    const findMediaLinks = (doc, rawHtml, baseUrl) => {
        const urls = new Set();

        findMp3Links(doc, baseUrl).forEach((url) => urls.add(url));
        findMp4Links(doc, baseUrl).forEach((url) => urls.add(url));
        findMediaLinksInText(rawHtml, baseUrl).forEach((url) => urls.add(url));

        return [...urls];
    };

    const sourceMatchesMime = (type, allowedTypes) => {
        if (!type) {
            return true;
        }
        return allowedTypes.has(type.trim().toLowerCase());
    };

    const findMp3Links = (doc, baseUrl) => {
        const urls = new Set();

        doc.querySelectorAll('audio source[src]').forEach((audioSource) => {
            const type = audioSource.getAttribute('type');
            if (!sourceMatchesMime(type, MP3_MIME_TYPES)) {
                return;
            }
            addMediaUrl(urls, audioSource.getAttribute('src'), baseUrl, isMp3Link);
        });

        doc.querySelectorAll('audio[src]').forEach((audioTag) => {
            addMediaUrl(urls, audioTag.getAttribute('src'), baseUrl, isMp3Link);
        });

        doc.querySelectorAll('audio[data-append]').forEach((audioTag) => {
            addMediaUrl(urls, audioTag.getAttribute('data-append'), baseUrl, isMp3Link);
        });

        doc.querySelectorAll('[data-mp3], [data-source]').forEach((element) => {
            const dataUrl = element.getAttribute('data-mp3') || element.getAttribute('data-source');
            addMediaUrl(urls, dataUrl, baseUrl, isMp3Link);
        });

        doc.querySelectorAll('a[href], link[href]').forEach((element) => {
            addMediaUrl(urls, element.getAttribute('href'), baseUrl, isMp3Link);
        });

        return [...urls];
    };

    const findMp4Links = (doc, baseUrl) => {
        const urls = new Set();

        doc.querySelectorAll('video source[src]').forEach((videoSource) => {
            const type = videoSource.getAttribute('type');
            if (!sourceMatchesMime(type, MP4_MIME_TYPES)) {
                return;
            }
            addMediaUrl(urls, videoSource.getAttribute('src'), baseUrl, isMp4Link);
        });

        doc.querySelectorAll('video[src]').forEach((videoTag) => {
            addMediaUrl(urls, videoTag.getAttribute('src'), baseUrl, isMp4Link);
        });

        doc.querySelectorAll('[data-mp4], [data-source]').forEach((element) => {
            const dataUrl = element.getAttribute('data-mp4') || element.getAttribute('data-source');
            addMediaUrl(urls, dataUrl, baseUrl, isMp4Link);
        });

        doc.querySelectorAll('a[href], link[href]').forEach((element) => {
            addMediaUrl(urls, element.getAttribute('href'), baseUrl, isMp4Link);
        });

        return [...urls];
    };

    /**
     * Handles form submission and fetches HTML content via a CORS proxy.
     * Parses the content for media links and displays results.
     * @param {Event} event
     */
    const handleFormSubmit = async (event) => {
        event.preventDefault();
        clearElement(resultEl);
        messageEl.textContent = '';

        const url = urlField.value.trim();
        if (!url) {
            messageEl.textContent = 'Please enter a valid URL.';
            return;
        }
        messageEl.textContent = 'Working, please wait...';

        try {
            const rawResponse = await fetchPageHtml(url);

            const parser = new DOMParser();
            const doc = parser.parseFromString(rawResponse, 'text/html');
            const mediaLinks = findMediaLinks(doc, rawResponse, url);

            messageEl.textContent = '';
            if (mediaLinks.length === 0) {
                resultEl.textContent = 'No media links found on that page.';
            } else {
                const subtitle = document.createElement('div');
                subtitle.innerHTML = '<strong>Media links found:</strong>';
                resultEl.appendChild(subtitle);

                const ul = document.createElement('ul');

                mediaLinks.forEach((link) => {
                    const li = document.createElement('li');
                    const anchor = document.createElement('a');
                    anchor.href = link;
                    anchor.target = '_blank';
                    anchor.rel = 'noopener noreferrer';

                    const fileName = link.substring(link.lastIndexOf('/') + 1);
                    const fileExtension = fileName.split('.').pop().toLowerCase();
                    const icon = document.createElement('i');

                    if (fileExtension === 'mp3') {
                        icon.className = 'fas fa-music';
                    } else if (fileExtension === 'mp4') {
                        icon.className = 'fas fa-video';
                    }

                    icon.style.color = '#fff';
                    icon.style.marginRight = '0.5em';
                    li.className = 'large-li';
                    li.appendChild(icon);
                    anchor.textContent = fileName;
                    li.appendChild(anchor);
                    ul.appendChild(li);
                });

                resultEl.appendChild(ul);
            }
        } catch (error) {
            messageEl.textContent = 'ERROR: Could not fetch or parse. Check the console.';
            console.error('Error processing URL:', error);
        }
    };

    /**
     * Handles incoming shared content via URL parameters.
     */
    const handleShareTarget = () => {
        const currentUrl = new URL(window.location.href);
        const sharedDescription = currentUrl.searchParams.get('description');
        let sharedLink = currentUrl.searchParams.get('link');

        if (!sharedLink && sharedDescription) {
            sharedLink = extractUrlFromText(sharedDescription);
        }

        if (sharedLink) {
            urlField.value = sharedLink;
            handleFormSubmit(new Event('submit'));
        }
    };

    urlField.addEventListener('focus', function () {
        this.select();
    });

    searchForm.addEventListener('submit', handleFormSubmit);
    document.addEventListener('DOMContentLoaded', handleShareTarget);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register('./service-worker.js')
                .then((registration) => {
                    console.log('ServiceWorker registered successfully with scope:', registration.scope);
                })
                .catch((err) => {
                    console.error('ServiceWorker registration failed:', err);
                });
        });
    }
})();
