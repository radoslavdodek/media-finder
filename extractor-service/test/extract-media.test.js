import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMedia} from '../src/extract-media.js';

test('extractMedia combines DOM, metadata, structured data, scripts, and network evidence', () => {
    const html = `
        <html>
            <head>
                <base href="https://cdn.example.com/assets/">
                <meta property="og:video" content="/watch/featured">
                <script type="application/ld+json">
                    {"@type":"AudioObject","contentUrl":"episode.mp3"}
                </script>
            </head>
            <body>
                <audio src="audio/theme.m4a"></audio>
                <video><source src="movie.webm" type="video/webm"></video>
                <div data-mp3="https:\/\/media.example.net\/escaped.mp3"></div>
                <script>window.stream = "https:\/\/stream.example.net\/live.m3u8";</script>
            </body>
        </html>`;

    const media = extractMedia({
        html,
        pageUrl: 'https://www.example.com/article',
        networkResponses: [{url: 'https://api.example.com/play?id=3', mimeType: 'audio/aac; charset=binary'}],
    });
    const byUrl = new Map(media.map((item) => [item.url, item]));

    assert.equal(byUrl.get('https://cdn.example.com/assets/audio/theme.m4a').kind, 'audio');
    assert.equal(byUrl.get('https://cdn.example.com/assets/movie.webm').kind, 'video');
    assert.equal(byUrl.get('https://media.example.net/escaped.mp3').kind, 'audio');
    assert.equal(byUrl.get('https://stream.example.net/live.m3u8').kind, 'playlist');
    assert.equal(byUrl.get('https://cdn.example.com/watch/featured').kind, 'video');
    assert.deepEqual(byUrl.get('https://api.example.com/play?id=3'), {
        url: 'https://api.example.com/play?id=3',
        kind: 'audio',
        source: 'network',
    });
});

test('extractMedia ignores unrelated links and de-duplicates media URLs', () => {
    const media = extractMedia({
        html: '<a href="/about">About</a><audio src="/same.mp3"></audio><a href="/same.mp3">Download</a>',
        pageUrl: 'https://example.com/page',
    });
    assert.deepEqual(media, [{url: 'https://example.com/same.mp3', kind: 'audio', source: 'audio[src]'}]);
});
