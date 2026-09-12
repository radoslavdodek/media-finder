import {BrowserRenderer} from './browser-renderer.js';
import {loadConfig} from './config.js';
import {ExtractionService} from './extraction-service.js';
import {createHttpServer} from './http-server.js';
import {createLogger} from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const browserRenderer = new BrowserRenderer(config.browser, logger);
const extractionService = new ExtractionService({config, browserRenderer, logger});
const server = createHttpServer({config, extractionService, logger});

server.listen(config.port, config.host, () => {
    logger.info('Media extractor listening', {
        host: config.host,
        port: config.port,
        browserEnabled: config.browser.enabled,
    });
});

const shutdown = async (signal) => {
    logger.info('Shutting down media extractor', {signal});
    server.close(async () => {
        await browserRenderer.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
