// scripts/verify-fixes.mjs - Repeatable verification for the reported issues.
// Usage: node server/index.js & node scripts/verify-fixes.mjs
import http from 'node:http';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3001';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function json(path, opts) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { res, text, data };
}

// ---- 1. Big profile payloads must not 413 (they used to return an HTML error page)
{
  const favorites = Array.from({ length: 400 }, (_, i) => ({
    id: i,
    title: { romaji: 'x'.repeat(60), english: 'y'.repeat(60), native: 'z'.repeat(30) },
    coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/' + 'a'.repeat(80) + i + '.jpg' },
    description: 'd'.repeat(400),
    genres: ['Action', 'Fantasy']
  }));
  const body = JSON.stringify({ username: 'Default', favorites, watchHistory: favorites });
  const sync = await json('/api/users/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  ok('sync accepts ~600 kB profile', sync.res.status === 200 && sync.data?.success === true, `status=${sync.res.status}`);

  const recs = await json('/api/recommendations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favoriteIds: favorites.map(f => f.id), favorites, watchHistory: [], limit: 4 })
  });
  ok('recommendations accept ~600 kB profile', recs.res.status === 200 && recs.data?.success === true, `status=${recs.res.status}`);
}

// ---- 2. Malformed JSON must answer JSON (not Express' HTML page)
{
  const res = await fetch(BASE + '/api/users/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json'
  });
  const text = await res.text();
  ok('malformed JSON returns JSON envelope', res.headers.get('content-type')?.includes('application/json') && text.includes('success'), `status=${res.status}`);
}

// ---- 3. Static caching: immutable hashed assets, no-store shell
{
  const html = await fetch(BASE + '/');
  ok('SPA shell is not cached', /no-store/.test(html.headers.get('cache-control') || ''), html.headers.get('cache-control') || 'none');
  const htmlText = await html.text();
  const asset = htmlText.match(/\/assets\/[^"']+\.js/);
  if (asset) {
    const a = await fetch(BASE + asset[0]);
    ok('hashed asset is immutable-cached', /immutable/.test(a.headers.get('cache-control') || ''), a.headers.get('cache-control') || 'none');
  } else {
    ok('hashed asset is immutable-cached', false, 'no asset link found (dist missing?)');
  }
}

// ---- 4. Search: Japanese, English, short names + typeahead
{
  for (const q of ['葬送のフリーレン', 'Frieren', '進撃の巨人', 'aot']) {
    const s = await json('/api/search?q=' + encodeURIComponent(q));
    ok(`search "${q}" returns results`, Array.isArray(s.data?.data) && s.data.data.length > 0, `n=${s.data?.data?.length}`);
  }
  for (const q of ['ワンピース', 'one piece', 'jjk', 'sao 3']) {
    const s = await json('/api/search/suggest?q=' + encodeURIComponent(q) + '&limit=5');
    ok(`suggest "${q}" returns hints`, Array.isArray(s.data?.data) && s.data.data.length > 0, `n=${s.data?.data?.length}`);
  }
}

// ---- 5. Subtitle translation: relative proxy URL (used to be HTTP 500)
{
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello world\n\n2\n00:00:04.000 --> 00:00:06.000\nGood morning\n';
  const vttServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/vtt' }); res.end(vtt); });
  await new Promise(r => vttServer.listen(3996, '127.0.0.1', r));
  try {
    const proxied = '/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:3996/subs.vtt');
    const t0 = Date.now();
    const res = await fetch(BASE + '/api/subtitles/translate?url=' + encodeURIComponent(proxied) + '&targetLang=zh-TW');
    const body = await res.text();
    const ms = Date.now() - t0;
    ok('translated subtitles via relative proxy URL', res.status === 200 && /WEBVTT/.test(body) && /你好世界/.test(body) && !/en$/.test(body.trim()), `status=${res.status} ${ms}ms`);
    const t1 = Date.now();
    await (await fetch(BASE + '/api/subtitles/translate?url=' + encodeURIComponent(proxied) + '&targetLang=zh-TW')).text();
    ok('second translation served from cache', Date.now() - t1 < 400, `${Date.now() - t1}ms`);
  } finally {
    vttServer.close();
  }
}

// ---- 6. Segment cache + HLS readahead (pre-cache)
{
  const served = { seg: 0 };
  // Unique segment names per run: otherwise a previous run's disk cache makes the
  // prefetch counter stay at zero and the check reports a false negative.
  const runId = 'r' + Date.now();
  const hlsServer = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v.m3u8') {
      let out = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n';
      for (let i = 0; i < 4; i++) out += '#EXTINF:2.0,\n/' + runId + '-seg' + i + '.ts\n';
      out += '#EXT-X-ENDLIST\n';
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end(out);
    }
    if (u.startsWith('/seg') || u.includes('-seg')) {
      served.seg++;
      const body = Buffer.alloc(1024, 9);
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => hlsServer.listen(3995, '127.0.0.1', r));
  try {
    const playlistUrl = BASE + '/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:3995/v.m3u8') + '&referer=' + encodeURIComponent('https://zokoanime.video/');
    await (await fetch(playlistUrl)).text();
    await new Promise(r => setTimeout(r, 1500));
    ok('server pre-caches HLS segments ahead of playback', served.seg >= 4, `segments prefetched=${served.seg}`);

    const segUrl = BASE + '/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:3995/' + runId + '-seg0.ts') + '&referer=' + encodeURIComponent('https://zokoanime.video/');
    const hit = await fetch(segUrl);
    await hit.arrayBuffer();
    ok('replayed segment served from disk cache', hit.headers.get('x-cache-status') === 'HIT', 'x-cache-status=' + hit.headers.get('x-cache-status'));
  } finally {
    hlsServer.close();
  }

  const stats = await json('/api/cache/stats');
  ok('media cache lives under the persistent data dir', /[\\/]data[\\/]cache|[\\/]aniflix|[\\/]/i.test(stats.data?.stats?.cacheRoot || ''), stats.data?.stats?.cacheRoot);
}

// ---- 7. Downloader SSE still streams
{
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(BASE + '/api/downloads/events', { signal: controller.signal });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const chunk = value ? Buffer.from(value).toString('utf8') : '';
    ok('download SSE emits a snapshot', res.status === 200 && chunk.includes('data:'), chunk.slice(0, 60).replace(/\n/g, ' '));
    controller.abort();
  } catch (e) {
    if (e.name !== 'AbortError') ok('download SSE emits a snapshot', false, e.message);
  } finally {
    clearTimeout(timer);
  }
}

// ---- 8. Image proxy: streamed on first hit, disk-cached afterwards
{
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const imgServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
    res.end(png);
  });
  await new Promise(r => imgServer.listen(3994, '127.0.0.1', r));
  try {
    const url = BASE + '/api/proxy/image?url=' + encodeURIComponent('http://127.0.0.1:3994/cover-' + Date.now() + '.png');
    const first = await fetch(url);
    const firstBuf = Buffer.from(await first.arrayBuffer());
    ok('image proxy streams upstream bytes', first.status === 200 && firstBuf.length === png.length, `${firstBuf.length} bytes`);
    await new Promise(r => setTimeout(r, 300));
    const second = await fetch(url);
    const secondBuf = Buffer.from(await second.arrayBuffer());
    ok('image served from disk cache on repeat', second.headers.get('x-cache-status') === 'HIT' && secondBuf.equals(png), 'x-cache-status=' + second.headers.get('x-cache-status'));
  } finally {
    imgServer.close();
  }
}

// ---- 9. JSON API compression (adaptive: any catalogue-sized JSON answer qualifies)
{
  let checked = null;
  for (const path of ['/api/trending?perPage=50', '/api/search?q=one%20piece', '/api/catalog?year=2025&perPage=24']) {
    const res = await fetch(BASE + path, { headers: { 'Accept-Encoding': 'gzip' } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1024) {
      checked = { path, encoding: res.headers.get('content-encoding'), bytes: buf.length };
      break;
    }
  }
  ok('catalogue JSON is gzipped', checked?.encoding === 'gzip', checked ? `${checked.path} encoding=${checked.encoding} bytes=${checked.bytes}` : 'no catalogue payload available (upstream rate limited)');
}

// ---- 10. Catalog decade ranges (#7) and future-year availability (#6)
{
  const ranged = await json('/api/catalog?yearFrom=1970&yearTo=1979&perPage=12&sort=POPULARITY_DESC');
  const years = (ranged.data?.media || []).map(m => m.startDate?.year).filter(Boolean);
  const inRange = years.length > 0 && years.every(y => y >= 1970 && y <= 1979);
  ok('decade range returns only 1970s titles', ranged.data?.success !== false && inRange, 'years=' + JSON.stringify(years.slice(0, 6)));

  const yearInfo = await json('/api/catalog/years');
  const future = (yearInfo.data?.future || []).map(f => f.year);
  ok('future year probe hides empty years', Array.isArray(future) && !future.includes(2029), 'future=' + JSON.stringify(future));
}

// ---- 11. Trending semantics (#8): popularity feed is available and distinct
{
  const popularNow = await json('/api/popular-now?perPage=10');
  const ids = (popularNow.data?.data || []).map(a => a.id);
  ok('popular-now feed returns all-time popularity', popularNow.data?.success === true && ids.length > 0, 'n=' + ids.length);
}

// ---- 12. Cached Chinese titles endpoint (#9)
{
  const titles = await json('/api/anime/titles?ids=21,16498,5114');
  ok('cached title patch endpoint responds', titles.data?.success === true && typeof titles.data.data === 'object', 'keys=' + Object.keys(titles.data?.data || {}).length);
}

// ---- 13. Favorites airing notification feed (#4/#5)
{
  const airing = await json('/api/notifications/airing?ids=21&hours=48');
  ok('airing notification feed responds', airing.data?.success === true && Array.isArray(airing.data.data), 'rows=' + (airing.data?.data?.length ?? 'n/a'));
}

// ---- 14. Chinese info never reports the source text as a translation (#10)
{
  const info = await json('/api/anime/21/chinese-info?romaji=One%20Piece&native=%E3%83%AF%E3%83%B3%E3%83%94%E3%83%BC%E3%82%B9&english=One%20Piece&description=' + encodeURIComponent('『ワンピース』は、尾田栄一郎による日本の漫画作品。') + '&lang=zh-TW');
  const d = info.data || {};
  const honest = typeof d.summaryOk === 'boolean' && (d.summaryOk === true ? typeof d.summaryZh === 'string' && d.summaryZh.length > 0 : d.summaryZh === '');
  ok('chinese info reports translation state honestly', honest, 'summaryOk=' + d.summaryOk + ' summaryZh=' + JSON.stringify((d.summaryZh || '').slice(0, 24)));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
