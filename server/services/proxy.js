// server/services/proxy.js - High-performance HLS & subtitle streaming proxy
import { Readable } from 'stream';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://zokoanime.video/';

/**
 * Rewrites an M3U8 playlist so all child playlists, video segments,
 * and key/init URLs route through the local proxy with proper Referer.
 */
function rewriteM3U8(content, baseUrl, referer) {
  const lines = content.split(/\r?\n/);
  const rewritten = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Rewrite tag attributes containing URI="..."
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
        try {
          const resolvedUri = new URL(uri, baseUrl).href;
          const proxyUri = `/api/proxy?url=${encodeURIComponent(resolvedUri)}&referer=${encodeURIComponent(referer)}`;
          return `URI="${proxyUri}"`;
        } catch {
          return match;
        }
      });
    }

    // Playlist or segment URI line
    try {
      const resolvedUri = new URL(trimmed, baseUrl).href;
      return `/api/proxy?url=${encodeURIComponent(resolvedUri)}&referer=${encodeURIComponent(referer)}`;
    } catch {
      return line;
    }
  });

  return rewritten.join('\n');
}

/**
 * Express handler for /api/proxy
 * Proxies M3U8 playlists, TS segments (.ts / .ts.jpg), and VTT subtitles.
 */
export async function handleProxyStream(req, res) {
  const targetUrl = req.query.url;
  const referer = req.query.referer || DEFAULT_REFERER;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const headers = {
      'User-Agent': DEFAULT_USER_AGENT,
      'Referer': referer,
      'Accept': '*/*'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstreamRes = await fetch(targetUrl, {
      headers,
      redirect: 'follow'
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      console.warn(`[Proxy] Upstream error ${upstreamRes.status} for ${targetUrl}`);
      return res.status(upstreamRes.status).send(`Upstream returned ${upstreamRes.status}`);
    }

    const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
    const effectiveUrl = upstreamRes.url || targetUrl;
    const isM3U8 = targetUrl.toLowerCase().includes('.m3u8') ||
                   effectiveUrl.toLowerCase().includes('.m3u8') ||
                   contentType.includes('mpegurl') ||
                   contentType.includes('application/x-mpegurl');

    const isVtt = targetUrl.toLowerCase().includes('.vtt') ||
                  effectiveUrl.toLowerCase().includes('.vtt') ||
                  contentType.includes('text/vtt');

    // Enable CORS for all proxied assets
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // 1. M3U8 Playlist
    if (isM3U8) {
      const text = await upstreamRes.text();
      const rewritten = rewriteM3U8(text, effectiveUrl, referer);

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(upstreamRes.status).send(rewritten);
    }

    // 2. VTT Subtitles
    if (isVtt) {
      const text = await upstreamRes.text();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(upstreamRes.status).send(text);
    }

    // 3. Video Segments (MPEG-TS, MP4, etc.)
    // Note: Upstream CDN disguises .ts files as .ts.jpg to bypass caching rules,
    // so we force video/mp2t content-type for .ts and .ts.jpg segments.
    if (targetUrl.includes('.ts') || targetUrl.includes('.jpg') || contentType.includes('video') || contentType.includes('octet-stream')) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
    }

    res.setHeader('Accept-Ranges', 'bytes');
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(upstreamRes.status);

    // Stream chunks directly with backpressure handling
    const nodeStream = Readable.fromWeb(upstreamRes.body);

    req.on('close', () => {
      nodeStream.destroy();
    });

    nodeStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    nodeStream.pipe(res);

  } catch (err) {
    console.error(`[Proxy] Failed to proxy stream for ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}
