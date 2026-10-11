import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

function findOpenSsl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\bin\\openssl.exe',
    path.join(os.homedir(), 'scoop', 'shims', 'openssl.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'openssl', 'current', 'bin', 'openssl.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'openssl.exe'),
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
    '/bin/openssl'
  ];

  for (const c of candidates) {
    if (c === 'openssl') {
      try {
        execSync('openssl version', { stdio: 'ignore', timeout: 1000 });
        return 'openssl';
      } catch {}
    } else {
      try {
        if (fs.existsSync(c)) {
          return `"${c}"`;
        }
      } catch {}
    }
  }
  return 'openssl';
}

/**
 * Ensures SSL certificate and private key exist, generating a self-signed
 * certificate if custom certificates are not provided by the user.
 * 
 * Supports:
 * - User-mounted certificates: cert.pem / fullchain.pem and key.pem / privkey.pem
 * - Auto-generated 2048-bit RSA self-signed certificates (valid for 10 years)
 */
export function getOrCreateSslCertificates(dataDir = process.env.ANIFLIX_DATA_DIR || path.join(process.cwd(), 'data')) {
  try {
    const sslDir = process.env.ANIFLIX_SSL_DIR || path.join(dataDir, 'ssl');
    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { recursive: true });
    }

    // 1. Check for standard certificate file names
    const certCandidates = ['cert.pem', 'fullchain.pem', 'server.crt', 'cert.crt'];
    const keyCandidates = ['key.pem', 'privkey.pem', 'server.key', 'key.key'];

    let certPath = null;
    let keyPath = null;

    for (const c of certCandidates) {
      const p = path.join(sslDir, c);
      if (fs.existsSync(p)) {
        certPath = p;
        break;
      }
    }

    for (const k of keyCandidates) {
      const p = path.join(sslDir, k);
      if (fs.existsSync(p)) {
        keyPath = p;
        break;
      }
    }

    // If both exist, load and return them
    if (certPath && keyPath) {
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');
      console.log(`[SSL] Loaded existing SSL certificate from: ${certPath}`);
      return { cert, key, certPath, keyPath, isSelfSigned: false };
    }

    // 2. Generate self-signed certificate using openssl
    const defaultCertPath = path.join(sslDir, 'cert.pem');
    const defaultKeyPath = path.join(sslDir, 'key.pem');

    console.log('[SSL] No SSL certificates found in /data/ssl. Generating high-security self-signed certificate...');
    
    const opensslBin = findOpenSsl();
    // Command creates a 2048-bit RSA certificate valid for 3650 days (10 years)
    const opensslCmd = `${opensslBin} req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 -subj "/CN=aniflix/O=AniFlix/C=TW" -keyout "${defaultKeyPath}" -out "${defaultCertPath}"`;
    
    try {
      execSync(opensslCmd, { stdio: 'pipe', timeout: 10000 });
      if (fs.existsSync(defaultCertPath) && fs.existsSync(defaultKeyPath)) {
        const cert = fs.readFileSync(defaultCertPath, 'utf8');
        const key = fs.readFileSync(defaultKeyPath, 'utf8');
        console.log(`[SSL] Successfully generated self-signed certificate: ${defaultCertPath}`);
        return { cert, key, certPath: defaultCertPath, keyPath: defaultKeyPath, isSelfSigned: true };
      }
    } catch (genErr) {
      console.warn('[SSL] OpenSSL generation failed or openssl is not in PATH:', genErr.message);
    }

    return null;
  } catch (err) {
    console.error('[SSL] SSL certificate manager error:', err.message);
    return null;
  }
}
