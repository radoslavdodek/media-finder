import * as cheerio from 'cheerio';

const MEDIA_EXTENSIONS = new Map([
    ['mp3', 'audio'], ['m4a', 'audio'], ['aac', 'audio'], ['ogg', 'audio'],
    ['oga', 'audio'], ['opus', 'audio'], ['wav', 'audio'], ['flac', 'audio'],
    ['mp4', 'video'], ['m4v', 'video'], ['webm', 'video'], ['ogv', 'video'],
    ['mov', 'video'], ['avi', 'video'], ['mkv', 'video'],
    ['m3u8', 'playlist'], ['mpd', 'playlist'],
]);

const kindFromMime = (value = '') => {
    const mime = value.split(';', 1)[0].trim().toLowerCase();
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

const kindFromUrl = (value) => {
    try {
        const pathname = new URL(value).pathname;
        const dot = pathname.lastIndexOf('.');
        return dot === -1 ? null : MEDIA_EXTENSIONS.get(pathname.slice(dot + 1).toLowerCase()) || null;
    } catch {
        return null;
    }
};

const resolveCandidate = (candidate, baseUrl) => {
    if (typeof candidate !== 'string') {
        return null;
    }
    const cleaned = cheerio.load(`<textarea>${candidate}</textarea>`)('textarea').text().trim();
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

const collector = (pageUrl) => {
    const results = new Map();
    return {
        add(candidate, {kind, mimeType, source = 'unknown'} = {}) {
            const url = resolveCandidate(candidate, pageUrl);
            const detectedKind = kind || kindFromMime(mimeType) || (url && kindFromUrl(url));
            if (!url || !detectedKind) {
                return;
            }
            if (!results.has(url)) {
                results.set(url, {url, kind: detectedKind, source});
            }
        },
        values: () => [...results.values()],
    };
};

const visitStructuredData = (value, add, inheritedMime = '') => {
    if (Array.isArray(value)) {
        value.forEach((item) => visitStructuredData(item, add, inheritedMime));
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }

    const mediaFields = new Set(['contenturl', 'embedurl', 'mediaurl', 'src', 'file', 'source']);
    const mimeType = value.encodingFormat || value.mimeType || value.type || inheritedMime;
    Object.entries(value).forEach(([key, child]) => {
        if (typeof child === 'string' && mediaFields.has(key.toLowerCase())) {
            add(child, {mimeType, source: 'structured-data'});
        } else {
            visitStructuredData(child, add, mimeType);
        }
    });
};

export const extractMedia = ({html, pageUrl, networkResponses = []}) => {
    const $ = cheerio.load(html);
    const baseHref = $('base[href]').first().attr('href');
    const documentBase = resolveCandidate(baseHref, pageUrl) || pageUrl;
    const found = collector(documentBase);

    $('audio[src]').each((_index, element) => found.add($(element).attr('src'), {kind: 'audio', source: 'audio[src]'}));
    $('audio[data-append]').each((_index, element) => found.add($(element).attr('data-append'), {
        kind: 'audio',
        source: 'audio[data-append]',
    }));
    $('audio source[src]').each((_index, element) => found.add($(element).attr('src'), {
        kind: kindFromMime($(element).attr('type')) || 'audio',
        source: 'audio source[src]',
    }));
    $('video[src]').each((_index, element) => found.add($(element).attr('src'), {kind: 'video', source: 'video[src]'}));
    $('video source[src]').each((_index, element) => found.add($(element).attr('src'), {
        kind: kindFromMime($(element).attr('type')) || 'video',
        source: 'video source[src]',
    }));

    $('[data-mp3], [data-mp4], [data-source]').each((_index, element) => {
        const node = $(element);
        const explicitKind = node.attr('data-mp3') ? 'audio' : node.attr('data-mp4') ? 'video' : null;
        found.add(node.attr('data-mp3') || node.attr('data-mp4') || node.attr('data-source'), {
            kind: explicitKind,
            mimeType: node.attr('data-type') || node.attr('type'),
            source: 'data-attribute',
        });
    });

    $('a[href], link[href]').each((_index, element) => found.add($(element).attr('href'), {
        mimeType: $(element).attr('type'),
        source: `${element.tagName}[href]`,
    }));
    $('meta[property^="og:video"], meta[name^="twitter:player:stream"]').each((_index, element) => {
        found.add($(element).attr('content'), {kind: 'video', source: 'media-meta'});
    });
    $('meta[property^="og:audio"], meta[name^="twitter:audio"]').each((_index, element) => {
        found.add($(element).attr('content'), {kind: 'audio', source: 'media-meta'});
    });

    $('script[type="application/ld+json"], script[type="application/json"]').each((_index, element) => {
        try {
            visitStructuredData(JSON.parse($(element).text()), found.add, '');
        } catch {
            // Raw script scanning below still handles URL-like values.
        }
    });

    const normalizedHtml = html
        .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
        .replace(/\\\//g, '/');
    // The boundary on relative URLs prevents matching the slash in ordinary
    // strings such as "audio/file.mp3" as if it were "/file.mp3".
    const candidates = normalizedHtml.match(/(?:https?:)?\/\/[^\s"'<>\\]+|(?<![\w:])(?:\/|\.\.?\/)[^\s"'<>\\]+/gi) || [];
    candidates.forEach((candidate) => found.add(candidate, {source: 'raw-html'}));

    networkResponses.forEach(({url, mimeType}) => found.add(url, {mimeType, source: 'network'}));
    return found.values();
};
