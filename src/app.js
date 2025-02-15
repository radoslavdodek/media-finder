(() => {
    'use strict';

    // Cache DOM nodes
    const urlField = document.getElementById('urlField');
    const searchForm = document.getElementById('searchForm');
    const messageEl = document.getElementById('message');
    const resultEl = document.getElementById('result');

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

    const isMp3Link = (url) => {
        return extractUrlFromText(url) && (url.toLowerCase().endsWith('.mp3'));
    };

    const isMp4Link = (url) => {
        return extractUrlFromText(url) && (url.toLowerCase().endsWith('.mp4'));
    };

    /**
     * Finds media links in the provided document by checking for audio/video elements and data attributes.
     * @param {Document} doc
     * @returns {string[]} Array of media file URLs.
     */
    const findMediaLinks = (doc) => {
        const urls = [];

        urls.append(...findMp3Links(doc));
        urls.append(...findMp4Links(doc));

        return urls;
    };

    const findMp3Links = (doc) => {
        const urls = [];

        // Look for <audio> source
        const audioSource = doc.querySelector('audio source[type="audio/mp3"]');
        let mp3Url = audioSource?.getAttribute('src') ?? null;

        if (!mp3Url) {
            // If no <source> found, check if <audio> has a 'src' directly
            const audioTag = doc.querySelector('audio[src]');
            if (audioTag) mp3Url = audioTag.getAttribute('src');
        }
        if (mp3Url && isMp3Link(mp3Url)) {
            urls.push(mp3Url);
        }

        // Look for elements with 'data-mp3' or 'data-source' attributes
        const dataElements = doc.querySelectorAll('[data-mp3], [data-source]');
        dataElements.forEach((element) => {
            const dataUrl = element.getAttribute('data-mp3') || element.getAttribute('data-source');
            if (dataUrl && isMp3Link(dataUrl)) {
                urls.push(dataUrl);
            }
        });

        return urls;
    }

    const findMp4Links = (doc) => {
        const urls = [];

        // Look for <audio> source
        const videoSource = doc.querySelector('audio source[type="video/mp4"]');
        let mp4Url = videoSource?.getAttribute('src') ?? null;

        if (!mp4Url) {
            // If no <source> found, check if <video> has a 'src' directly
            const videoTag = doc.querySelector('video[src]');
            if (videoTag) mp4Url = videoTag.getAttribute('src');
        }
        if (mp4Url && isMp4Link(mp4Url)) {
            urls.push(mp4Url);
        }

        // Look for elements with 'data-mp4' or 'data-source' attributes
        const dataElements = doc.querySelectorAll('[data-mp4], [data-source]');
        dataElements.forEach((element) => {
            const dataUrl = element.getAttribute('data-mp4') || element.getAttribute('data-source');
            if (dataUrl && isMp4Link(dataUrl)) {
                urls.push(dataUrl);
            }
        });

        return urls;
    }

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
            const response = await fetch(
                `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
                {mode: 'cors'}
            );
            const rawResponse = await response.text();

            // Parse HTML string into a Document
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawResponse, 'text/html');
            const mediaLinks = findMediaLinks(doc);

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
                    anchor.textContent = link;
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

        // If link isn’t directly provided, try to extract from the description
        if (!sharedLink && sharedDescription) {
            sharedLink = extractUrlFromText(sharedDescription);
        }

        if (sharedLink) {
            urlField.value = sharedLink;
            // Optionally, auto-submit if a shared link is provided
            handleFormSubmit(new Event('submit'));
        }
    };

    // Auto select the entire URL on focus for better UX.
    urlField.addEventListener('focus', function () {
        this.select();
    });

    // Register form submit listener.
    searchForm.addEventListener('submit', handleFormSubmit);

    // Process share_target parameters on page load
    document.addEventListener('DOMContentLoaded', handleShareTarget);

    // Service Worker registration for offline support
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