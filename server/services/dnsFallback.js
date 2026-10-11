// server/services/dnsFallback.js - Resilient DNS Resolver with Multi-Provider DNS-over-HTTPS (DoH) & IPv4 priority
// Bypasses ISP/router poisoned or non-resolving anime and torrent domain issues (e.g. getaddrinfo ENOENT nyaa.si, share.dmhy.org)
import dns from 'node:dns';
import https from 'node:https';

const FALLBACK_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4'];

let isConfigured = false;
const dohCache = new Map(); // hostname -> { ip, expireAt }

function fetchDnsJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let timer = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
    };

    const req = https.get(url, { headers: { 'accept': 'application/dns-json' }, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (finished) return;
        cleanup();
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      if (finished) return;
      cleanup();
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      if (finished) return;
      cleanup();
      resolve(null);
    });

    timer = setTimeout(() => {
      if (finished) return;
      cleanup();
      req.destroy();
      resolve(null);
    }, timeoutMs + 100);
  });
}

export async function dohLookup(hostname) {
  const cached = dohCache.get(hostname);
  if (cached && Date.now() < cached.expireAt) {
    return cached.ip;
  }

  // Race multiple globally accessible DoH providers in parallel (Cloudflare, Google, AliDNS)
  const endpoints = [
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://8.8.8.8/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://223.5.5.5/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://1.0.0.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`
  ];

  const queryEndpoint = async (ep) => {
    const data = await fetchDnsJson(ep, 2500);
    if (data && Array.isArray(data.Answer)) {
      const valid = data.Answer.find(a => a.type === 1 && a.data && !isBadAddr(a.data));
      if (valid) {
        return valid.data;
      }
    }
    throw new Error('No valid A record');
  };

  try {
    const ip = await Promise.any(endpoints.map(ep => queryEndpoint(ep)));
    if (ip) {
      dohCache.set(hostname, { ip, expireAt: Date.now() + 300000 }); // 5 minutes TTL
      return ip;
    }
  } catch {}

  return null;
}

function isBadAddr(addr) {
  if (!addr) return true;
  if (typeof addr === 'string') return addr === '0.0.0.0' || addr.startsWith('127.') || addr === '::';
  if (Array.isArray(addr)) return addr.length === 0 || addr.every(a => isBadAddr(a.address));
  return false;
}

export async function setupDnsFallback() {
  if (isConfigured) return;
  isConfigured = true;

  try {
    dns.setServers(FALLBACK_DNS_SERVERS);
  } catch (err) {
    console.warn('[DNS] Failed to set fallback DNS servers:', err.message);
  }

  try {
    const { Agent, setGlobalDispatcher } = await import('undici');

    function customLookup(hostname, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }

      // 1. First attempt standard system lookup
      dns.lookup(hostname, options, async (err, address, family) => {
        // If standard lookup returned a real address (not poisoned/sinkholed 0.0.0.0 or 127.x)
        if (!err && !isBadAddr(address)) {
          // If address is an array, prioritize IPv4 so broken IPv6 routing doesn't cause connection timeouts
          if (Array.isArray(address)) {
            const v4 = address.filter(a => a.family === 4 && !isBadAddr(a.address));
            const v6 = address.filter(a => a.family === 6 && !isBadAddr(a.address));
            const sorted = [...v4, ...v6];
            if (sorted.length > 0) {
              return callback(null, sorted);
            }
          } else {
            return callback(null, address, family);
          }
        }

        // 2. Resilient Fallback: DNS-over-HTTPS (Parallel DoH via Cloudflare, Google, AliDNS)
        try {
          const dohIp = await dohLookup(hostname);
          if (dohIp) {
            if (options && options.all) {
              return callback(null, [{ address: dohIp, family: 4 }]);
            }
            return callback(null, dohIp, 4);
          }
        } catch {}

        // 3. Fallback to UDP resolve4 if DoH was unreachable
        dns.resolve4(hostname, (rErr, addrs) => {
          const validUdp = addrs && addrs.find(a => !isBadAddr(a));
          if (!rErr && validUdp) {
            if (options && options.all) {
              return callback(null, [{ address: validUdp, family: 4 }]);
            }
            return callback(null, validUdp, 4);
          }
          callback(err || rErr || new Error(`DNS resolution failed for ${hostname}`));
        });
      });
    }

    const agent = new Agent({
      connect: {
        lookup: customLookup
      }
    });

    setGlobalDispatcher(agent);
    console.log('[DNS] Resilient multi-provider DNS fallback successfully configured (DoH + IPv4 Priority).');
  } catch (err) {
    console.warn('[DNS] undici dispatcher skipped, continuing with standard DNS:', err.message);
  }
}

// Automatically invoke on module load with top-level await
await setupDnsFallback();
