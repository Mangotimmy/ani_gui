// server/services/dnsFallback.js - Resilient DNS Resolver with DNS-over-HTTPS (DoH) & Cloudflare/Google fallbacks
// Bypasses ISP/router poisoned or non-resolving anime and torrent domain issues (e.g. getaddrinfo ENOENT nyaa.si, share.dmhy.org)
import dns from 'node:dns';
import https from 'node:https';

const FALLBACK_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4'];

let isConfigured = false;
const dohCache = new Map(); // hostname -> { ip, expireAt }

function fetchDnsJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'accept': 'application/dns-json' }, timeout: 4000 }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

export async function dohLookup(hostname) {
  const cached = dohCache.get(hostname);
  if (cached && Date.now() < cached.expireAt) {
    return cached.ip;
  }

  const endpoints = [
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://8.8.8.8/resolve?name=${encodeURIComponent(hostname)}&type=A`
  ];

  for (const ep of endpoints) {
    const data = await fetchDnsJson(ep);
    if (data && Array.isArray(data.Answer)) {
      const valid = data.Answer.find(a => a.type === 1 && a.data && a.data !== '0.0.0.0' && !a.data.startsWith('127.'));
      if (valid) {
        const ttl = (valid.TTL && valid.TTL > 60) ? Math.min(valid.TTL * 1000, 3600000) : 300000;
        dohCache.set(hostname, { ip: valid.data, expireAt: Date.now() + ttl });
        return valid.data;
      }
    }
  }
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
          return callback(null, address, family);
        }

        // 2. Resilient Fallback: DNS-over-HTTPS (DoH via Cloudflare 1.1.1.1 & Google 8.8.8.8)
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
    console.log('[DNS] Resilient DNS fallback successfully configured (1.1.1.1 / 8.8.8.8 + DoH).');
  } catch (err) {
    console.warn('[DNS] undici dispatcher skipped, continuing with standard DNS:', err.message);
  }
}

// Automatically invoke on module load
await setupDnsFallback();
