(() => {
    'use strict';

    // Cache DOM nodes
    const urlField = document.getElementById('urlField');
    const searchForm = document.getElementById('searchForm');
    const messageEl = document.getElementById('message');
    const resultEl = document.getElementById('result');

    const MEDIA_EXTENSIONS = new Map([
        ['mp3', 'audio'], ['m4a', 'audio'], ['aac', 'audio'], ['ogg', 'audio'],
        ['oga', 'audio'], ['opus', 'audio'], ['wav', 'audio'], ['flac', 'audio'],
        ['mp4', 'video'], ['m4v', 'video'], ['webm', 'video'], ['ogv', 'video'],
        ['mov', 'video'], ['avi', 'video'], ['mkv', 'video'],
        ['m3u8', 'playlist'], ['mpd', 'playlist'],
    ]);

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
            const resolved = new URL(cleaned, baseUrl);
            return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : null;
        } catch {
            return null;
        }
    };

    const getMediaKindFromUrl = (url) => {
        try {
            const path = new URL(url).pathname;
            const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
            return MEDIA_EXTENSIONS.get(extension) || null;
        } catch {
            return null;
        }
    };

    const getMediaKindFromMime = (type) => {
        const mime = type?.split(';', 1)[0].trim().toLowerCase();
        if (!mime) {
            return null;
        }
        if (mime.startsWith('audio/')) {
            return 'audio';
        }
        if (mime.startsWith('video/')) {
            return 'video';
        }
        if (['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/dash+xml'].includes(mime)) {
            return 'playlist';
        }
        return null;
    };

    /**
     * @param {Set<string>} urls
     * @param {string|null} candidate
     * @param {string} baseUrl
     * @param {{kind?: string|null, mimeType?: string|null}} [evidence]
     */
    const addMediaUrl = (urls, candidate, baseUrl, evidence = {}) => {
        const resolved = resolveMediaUrl(candidate, baseUrl);
        const kind = evidence.kind || getMediaKindFromMime(evidence.mimeType) || (resolved && getMediaKindFromUrl(resolved));
        if (resolved && kind) {
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

        return /<[a-z][\w:-]*(?:\s[^>]*)?>/i.test(trimmed);
    };

    /**
     * Fetches page HTML through a proxy, trying same-origin first then public fallbacks.
     * @param {string} pageUrl
     * @returns {Promise<string>}
     */
    const fetchPageHtml = async (pageUrl) => {
        const encodedUrl = encodeURIComponent(pageUrl);
        const appScriptUrl = document.querySelector('script[src$="app.js"]')?.src || window.location.href;
        const proxies = [
            {
                name: 'same-origin',
                buildUrl: () => {
                    const proxyUrl = new URL('proxy', appScriptUrl);
                    proxyUrl.searchParams.set('url', pageUrl);
                    return proxyUrl.href;
                },
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
     * Finds direct media URLs embedded in raw HTML or script content. Script URLs
     * are commonly JSON-escaped, so normalize only the escape forms used in URLs.
     * @param {string} rawHtml
     * @param {string} baseUrl
     * @returns {Set<string>}
     */
    const findMediaLinksInText = (rawHtml, baseUrl) => {
        const urls = new Set();
        const normalized = rawHtml
            .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
            .replace(/\\\//g, '/');
        const urlPattern = /(?:https?:)?\/\/[^\s"'<>\\]+|(?:\/|\.\.?\/)[^\s"'<>\\]+/gi;

        (normalized.match(urlPattern) || []).forEach((match) => addMediaUrl(urls, match, baseUrl));

        return urls;
    };

    const getDocumentBaseUrl = (doc, pageUrl) => {
        const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
        return resolveMediaUrl(baseHref, pageUrl) || pageUrl;
    };

    const findStructuredMediaLinks = (doc, baseUrl) => {
        const urls = new Set();
        const mediaFields = new Set(['contenturl', 'embedurl', 'mediaurl', 'src', 'file', 'source']);

        const visit = (value, inheritedMime = null) => {
            if (Array.isArray(value)) {
                value.forEach((item) => visit(item, inheritedMime));
                return;
            }
            if (!value || typeof value !== 'object') {
                return;
            }

            const mimeType = value.encodingFormat || value.mimeType || value.type || inheritedMime;
            Object.entries(value).forEach(([key, child]) => {
                if (typeof child === 'string' && mediaFields.has(key.toLowerCase())) {
                    addMediaUrl(urls, child, baseUrl, {mimeType});
                } else {
                    visit(child, mimeType);
                }
            });
        };

        doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]').forEach((script) => {
            try {
                visit(JSON.parse(script.textContent));
            } catch {
                // Other raw script scanning still handles non-JSON script payloads.
            }
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

        const documentBaseUrl = getDocumentBaseUrl(doc, baseUrl);

        findAudioLinks(doc, documentBaseUrl).forEach((url) => urls.add(url));
        findVideoLinks(doc, documentBaseUrl).forEach((url) => urls.add(url));
        findStructuredMediaLinks(doc, documentBaseUrl).forEach((url) => urls.add(url));
        findMediaLinksInText(rawHtml, documentBaseUrl).forEach((url) => urls.add(url));

        return [...urls];
    };

    const findAudioLinks = (doc, baseUrl) => {
        const urls = new Set();

        doc.querySelectorAll('audio source[src]').forEach((audioSource) => {
            const type = audioSource.getAttribute('type');
            addMediaUrl(urls, audioSource.getAttribute('src'), baseUrl, {kind: getMediaKindFromMime(type) || 'audio'});
        });

        doc.querySelectorAll('audio[src]').forEach((audioTag) => {
            addMediaUrl(urls, audioTag.getAttribute('src'), baseUrl, {kind: 'audio'});
        });

        doc.querySelectorAll('audio[data-append]').forEach((audioTag) => {
            addMediaUrl(urls, audioTag.getAttribute('data-append'), baseUrl, {kind: 'audio'});
        });

        doc.querySelectorAll('[data-mp3], [data-source]').forEach((element) => {
            const isNamedAudioSource = element.hasAttribute('data-mp3');
            const dataUrl = element.getAttribute('data-mp3') || element.getAttribute('data-source');
            addMediaUrl(urls, dataUrl, baseUrl, {
                kind: isNamedAudioSource ? 'audio' : null,
                mimeType: element.getAttribute('data-type') || element.getAttribute('type'),
            });
        });

        doc.querySelectorAll('a[href], link[href]').forEach((element) => {
            addMediaUrl(urls, element.getAttribute('href'), baseUrl, {mimeType: element.getAttribute('type')});
        });

        return [...urls];
    };

    const findVideoLinks = (doc, baseUrl) => {
        const urls = new Set();

        doc.querySelectorAll('video source[src]').forEach((videoSource) => {
            const type = videoSource.getAttribute('type');
            addMediaUrl(urls, videoSource.getAttribute('src'), baseUrl, {kind: getMediaKindFromMime(type) || 'video'});
        });

        doc.querySelectorAll('video[src]').forEach((videoTag) => {
            addMediaUrl(urls, videoTag.getAttribute('src'), baseUrl, {kind: 'video'});
        });

        doc.querySelectorAll('[data-mp4], [data-source]').forEach((element) => {
            const isNamedVideoSource = element.hasAttribute('data-mp4');
            const dataUrl = element.getAttribute('data-mp4') || element.getAttribute('data-source');
            addMediaUrl(urls, dataUrl, baseUrl, {
                kind: isNamedVideoSource ? 'video' : null,
                mimeType: element.getAttribute('data-type') || element.getAttribute('type'),
            });
        });

        doc.querySelectorAll('a[href], link[href]').forEach((element) => {
            addMediaUrl(urls, element.getAttribute('href'), baseUrl, {mimeType: element.getAttribute('type')});
        });

        doc.querySelectorAll('meta[property^="og:video"], meta[name^="twitter:player:stream"]').forEach((meta) => {
            addMediaUrl(urls, meta.getAttribute('content'), baseUrl, {kind: 'video'});
        });

        doc.querySelectorAll('meta[property^="og:audio"], meta[name^="twitter:audio"]').forEach((meta) => {
            addMediaUrl(urls, meta.getAttribute('content'), baseUrl, {kind: 'audio'});
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
                resultEl.textContent = 'No static media URLs found. Media requested only after JavaScript runs cannot be inspected by this version.';
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
