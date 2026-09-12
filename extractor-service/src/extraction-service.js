import {TtlCache} from './cache.js';
import {UpstreamError} from './errors.js';
import {extractMedia} from './extract-media.js';
import {fetchPage} from './fetch-page.js';
import {parseTargetUrl} from './network-policy.js';

export class ExtractionService {
    constructor({config, browserRenderer, logger, fetcher = fetchPage}) {
        this.config = config;
        this.browserRenderer = browserRenderer;
        this.logger = logger;
        this.fetcher = fetcher;
        this.cache = new TtlCache({ttlMs: config.cacheTtlMs, maxEntries: config.cacheMaxEntries});
    }

    async extract(input) {
        const normalizedUrl = parseTargetUrl(input).href;
        const cached = this.cache.get(normalizedUrl);
        if (cached) {
            return {...cached, cached: true};
        }

        let fetched;
        let staticError;
        try {
            fetched = await this.fetcher(normalizedUrl, this.config);
        } catch (error) {
            staticError = error;
        }

        const staticWasBlocked = fetched?.challenge || fetched?.status === 403 || fetched?.status === 429;
        if (fetched && !staticWasBlocked && fetched.status >= 200 && fetched.status < 300) {
            const media = extractMedia({html: fetched.body, pageUrl: fetched.finalUrl});
            if (media.length > 0 || !this.browserRenderer.canRender(fetched.finalUrl)) {
                const result = {
                    pageUrl: fetched.finalUrl,
                    strategy: 'static',
                    media,
                    warnings: media.length === 0 ? ['No static media URLs were found.'] : [],
                    cached: false,
                };
                this.cache.set(normalizedUrl, result);
                return result;
            }
        }

        if (this.browserRenderer.canRender(normalizedUrl)) {
            this.logger.info('Using browser fallback', {hostname: new URL(normalizedUrl).hostname});
            const rendered = await this.browserRenderer.render(normalizedUrl);
            const media = extractMedia({
                html: rendered.html,
                pageUrl: rendered.finalUrl,
                networkResponses: rendered.networkResponses,
            });
            const result = {
                pageUrl: rendered.finalUrl,
                strategy: 'browser',
                media,
                warnings: media.length === 0 ? ['No media URLs were found after rendering the page.'] : [],
                cached: false,
            };
            this.cache.set(normalizedUrl, result);
            return result;
        }

        if (staticError) {
            throw staticError;
        }
        if (staticWasBlocked) {
            throw new UpstreamError('UPSTREAM_BLOCKED', 'The website blocked the extraction request.', {
                status: 502,
                details: {upstreamStatus: fetched.status, browserFallbackEnabled: false},
            });
        }
        throw new UpstreamError('UPSTREAM_HTTP_ERROR', 'The website returned an unsuccessful response.', {
            details: {upstreamStatus: fetched?.status || 0},
        });
    }
}
