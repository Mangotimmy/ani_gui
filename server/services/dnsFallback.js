// server/services/dnsFallback.js - Resilient DNS Resolver with Cloudflare & Google fallbacks
// Bypasses ISP/router poisoned or non-resolving anime domain issues (e.g. getaddrinfo ENOENT hianime.at)
import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

const FALLBACK_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4'];

let isConfigured = false;

export function setupDnsFallback() {
  if (isConfigured) return;
  isConfigured = true;

  try {
    dns.setServers(FALLBACK_DNS_SERVERS);

    function customLookup(hostname, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }

      // First attempt standard system lookup
      dns.lookup(hostname, options, (err, address, family) => {
        if (!err && address) {
          return callback(null, address, family);
        }

        // If system lookup fails (e.g. ENOENT from local ISP/router), resolve via 1.1.1.1/8.8.8.8
        dns.resolve4(hostname, (rErr, addrs) => {
          if (!rErr && addrs && addrs.length > 0) {
            if (options && options.all) {
              return callback(null, addrs.map(a => ({ address: a, family: 4 })));
            }
            return callback(null, addrs[0], 4);
          }
          callback(err || rErr);
        });
      });
    }

    const agent = new Agent({
      connect: {
        lookup: customLookup
      }
    });

    setGlobalDispatcher(agent);
    console.log('[DNS] Resilient DNS fallback successfully configured (1.1.1.1 / 8.8.8.8).');
  } catch (err) {
    console.warn('[DNS] DNS fallback initialization skipped:', err.message);
  }
}

// Automatically invoke on module load
setupDnsFallback();
