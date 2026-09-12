import {UpstreamError} from './errors.js';
import {hostnameMatches, validateAndResolveUrl} from './network-policy.js';

class Semaphore {
    constructor(maximum) {
        this.maximum = maximum;
        this.active = 0;
        this.queue = [];
    }

    async use(callback) {
        if (this.active >= this.maximum) {
            await new Promise((resolve) => this.queue.push(resolve));
        }
        this.active += 1;
        try {
            return await callback();
        } finally {
            this.active -= 1;
            this.queue.shift()?.();
        }
    }
}

export class BrowserRenderer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.browser = null;
        this.semaphore = new Semaphore(config.maxConcurrency);
    }

    canRender(url) {
        return this.config.enabled && hostnameMatches(new URL(url).hostname, this.config.allowedHosts);
    }

    async getBrowser() {
        if (this.browser) {
            return this.browser;
        }

        let chromium;
        try {
            ({chromium} = await import('playwright-core'));
        } catch (error) {
            throw new UpstreamError('BROWSER_UNAVAILABLE', 'Browser fallback is enabled but playwright-core is not installed.', {
                cause: error,
            });
        }

        const proxy = this.config.proxyServer ? {
            server: this.config.proxyServer,
            ...(this.config.proxyUsername ? {username: this.config.proxyUsername} : {}),
            ...(this.config.proxyPassword ? {password: this.config.proxyPassword} : {}),
        } : undefined;

        try {
            this.browser = await chromium.launch({
                headless: true,
                ...(this.config.executablePath ? {executablePath: this.config.executablePath} : {}),
                ...(proxy ? {proxy} : {}),
                args: this.config.disableSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
            });
            this.browser.once('disconnected', () => {
                this.browser = null;
            });
            return this.browser;
        } catch (error) {
            throw new UpstreamError('BROWSER_UNAVAILABLE', 'Chromium could not be started.', {cause: error});
        }
    }

    async render(input) {
        return this.semaphore.use(async () => {
            const {url} = await validateAndResolveUrl(input);
            if (!this.canRender(url.href)) {
                throw new UpstreamError('BROWSER_NOT_ALLOWED', 'Browser fallback is not enabled for this hostname.');
            }

            const browser = await this.getBrowser();
            const context = await browser.newContext({
                acceptDownloads: false,
                serviceWorkers: 'block',
            });
            const page = await context.newPage();
            const networkResponses = [];
            const validatedHosts = new Map();

            page.on('response', (response) => {
                const headers = response.headers();
                const responseUrl = response.url();
                const mimeType = headers['content-type'] || '';
                const looksLikeMedia = /^(?:audio|video)\//i.test(mimeType)
                    || /(?:mpegurl|dash\+xml)/i.test(mimeType)
                    || /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|ogv|mov|avi|mkv|m3u8|mpd)(?:[?#]|$)/i.test(responseUrl);
                if (looksLikeMedia && networkResponses.length < 1000) {
                    networkResponses.push({url: responseUrl, mimeType});
                }
            });

            await page.route('**/*', async (route) => {
                const requestUrl = route.request().url();
                let parsed;
                try {
                    parsed = new URL(requestUrl);
                    if (!['http:', 'https:'].includes(parsed.protocol)) {
                        await route.abort('blockedbyclient');
                        return;
                    }

                    const cacheKey = parsed.hostname.toLowerCase();
                    if (!validatedHosts.has(cacheKey)) {
                        validatedHosts.set(cacheKey, validateAndResolveUrl(parsed.href));
                    }
                    await validatedHosts.get(cacheKey);
                    await route.continue();
                } catch {
                    await route.abort('blockedbyclient');
                }
            });

            try {
                const response = await page.goto(url.href, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.config.timeoutMs,
                });
                await page.waitForLoadState('networkidle', {timeout: Math.min(5000, this.config.timeoutMs)}).catch(() => {});
                const html = await page.content();
                const status = response?.status() || 0;
                const headers = response?.headers() || {};
                const challenged = status === 403 && (
                    String(headers['cf-mitigated'] || '').toLowerCase() === 'challenge'
                    || /<title>\s*just a moment(?:\.\.\.)?\s*<\/title>/i.test(html)
                );
                if (challenged) {
                    throw new UpstreamError('UPSTREAM_BLOCKED', 'The website presented a browser challenge.', {
                        status: 502,
                        details: {upstreamStatus: status},
                    });
                }

                return {
                    html,
                    finalUrl: page.url(),
                    networkResponses,
                    status,
                };
            } catch (error) {
                if (error instanceof UpstreamError) {
                    throw error;
                }
                throw new UpstreamError('BROWSER_FAILED', 'The browser could not render the website.', {cause: error});
            } finally {
                await context.close();
            }
        });
    }

    async close() {
        await this.browser?.close();
        this.browser = null;
    }
}
