(() => {
    'use strict';

    const urlField = document.getElementById('urlField');
    const searchForm = document.getElementById('searchForm');
    const fetchButton = document.getElementById('fetchBtn');
    const messageEl = document.getElementById('message');
    const resultEl = document.getElementById('result');
    const requestTimeoutMs = 40_000;

    const scriptUrl = document.currentScript?.src
        || document.querySelector('script[src*="app.js"]')?.src
        || window.location.href;
    const extractionEndpoint = new URL('api/extract', scriptUrl).href;

    const errorMessages = new Map([
        ['INVALID_URL', 'Please enter a valid public HTTP or HTTPS URL.'],
        ['UPSTREAM_BLOCKED', 'The website blocked the extraction request or presented a browser challenge.'],
        ['TIMEOUT', 'The website did not respond in time. Please try again.'],
        ['UPSTREAM_UNAVAILABLE', 'The website could not be reached.'],
        ['UNSUPPORTED_CONTENT', 'The URL did not return an HTML page.'],
        ['RESPONSE_TOO_LARGE', 'The page is too large to inspect.'],
        ['RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'],
        ['BROWSER_UNAVAILABLE', 'The browser extraction service is temporarily unavailable.'],
        ['BROWSER_FAILED', 'The page could not be rendered by the extraction service.'],
        ['INVALID_RESPONSE', 'The extraction service returned an invalid response.'],
    ]);

    /**
     * Clears all child nodes of the target element.
     * @param {HTMLElement} element
     */
    const clearElement = (element) => {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    };

    /**
     * Extracts the first URL found in shared text.
     * @param {string} text
     * @returns {string|null}
     */
    const extractUrlFromText = (text) => {
        const match = text.match(/https?:\/\/\S+/i);
        return match ? match[0] : null;
    };

    const validatePageUrl = (input) => {
        try {
            const url = new URL(input);
            return ['http:', 'https:'].includes(url.protocol);
        } catch {
            return false;
        }
    };

    const requestExtraction = async (pageUrl) => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
            const response = await fetch(extractionEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({url: pageUrl}),
                signal: controller.signal,
            });

            let payload;
            try {
                payload = await response.json();
            } catch {
                throw Object.assign(new Error('The extraction service returned an invalid response.'), {
                    code: 'INVALID_RESPONSE',
                });
            }

            if (!response.ok) {
                throw Object.assign(new Error(payload?.error?.message || `HTTP ${response.status}`), {
                    code: payload?.error?.code || 'SERVICE_ERROR',
                    status: response.status,
                });
            }

            if (!payload || !Array.isArray(payload.media)) {
                throw Object.assign(new Error('The extraction service response did not contain media results.'), {
                    code: 'INVALID_RESPONSE',
                });
            }

            return payload;
        } finally {
            window.clearTimeout(timeout);
        }
    };

    const getErrorMessage = (error) => {
        if (error.name === 'AbortError') {
            return 'The extraction request took too long. Please try again.';
        }

        return errorMessages.get(error.code) || 'Could not inspect the page. Please try again later.';
    };

    const getMediaLabel = (url) => {
        try {
            const parsed = new URL(url);
            const fileName = parsed.pathname.split('/').filter(Boolean).pop();
            return fileName ? decodeURIComponent(fileName) : parsed.hostname;
        } catch {
            return url;
        }
    };

    const getIconClass = (kind) => {
        if (kind === 'audio') {
            return 'fas fa-music';
        }
        if (kind === 'video') {
            return 'fas fa-video';
        }
        if (kind === 'playlist') {
            return 'fas fa-list';
        }
        return 'fas fa-link';
    };

    const renderResults = (payload) => {
        const media = payload.media.filter((item) => {
            if (!item || typeof item.url !== 'string') {
                return false;
            }
            try {
                return ['http:', 'https:'].includes(new URL(item.url).protocol);
            } catch {
                return false;
            }
        });

        if (media.length === 0) {
            resultEl.textContent = payload.warnings?.[0] || 'No media URLs were found.';
            return;
        }

        const subtitle = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = 'Media links found:';
        subtitle.appendChild(strong);
        resultEl.appendChild(subtitle);

        const list = document.createElement('ul');
        media.forEach((item) => {
            const listItem = document.createElement('li');
            const icon = document.createElement('i');
            const anchor = document.createElement('a');

            icon.className = getIconClass(item.kind);
            icon.style.color = '#fff';
            icon.style.marginRight = '0.5em';

            anchor.href = item.url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = getMediaLabel(item.url);

            listItem.className = 'large-li';
            listItem.appendChild(icon);
            listItem.appendChild(anchor);
            list.appendChild(listItem);
        });
        resultEl.appendChild(list);
    };

    const handleFormSubmit = async (event) => {
        event.preventDefault();
        clearElement(resultEl);
        messageEl.textContent = '';

        const url = urlField.value.trim();
        if (!validatePageUrl(url)) {
            messageEl.textContent = 'Please enter a valid HTTP or HTTPS URL.';
            return;
        }

        fetchButton.disabled = true;
        messageEl.textContent = 'Working, please wait...';

        try {
            const payload = await requestExtraction(url);
            messageEl.textContent = '';
            renderResults(payload);
        } catch (error) {
            messageEl.textContent = getErrorMessage(error);
            console.error('Error processing URL:', error);
        } finally {
            fetchButton.disabled = false;
        }
    };

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
                .catch((error) => {
                    console.error('ServiceWorker registration failed:', error);
                });
        });
    }
})();
