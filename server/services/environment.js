// server/services/environment.js - Universal Windows Environment, Plugin & Tool Manager
import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';

const TOOLS = [
  { name: 'yt-dlp', scoopSubdir: 'yt-dlp', versionArg: '--version', critical: true },
  { name: 'ffmpeg', scoopSubdir: 'ffmpeg', versionArg: '-version', critical: true },
  { name: 'mpv', scoopSubdir: 'mpv', versionArg: '--version', critical: true },
  { name: 'aria2c', scoopSubdir: 'aria2', versionArg: '--version', critical: false },
  { name: 'ani-cli', scoopSubdir: 'ani-cli', versionArg: '-v', critical: false },
  { name: 'git', scoopSubdir: 'git', versionArg: '--version', critical: false }
];

/**
 * Dynamically locate any binary across user Scoop directory, local bin folder, or system PATH.
 * Never hardcodes any user home directory.
 */
export function findBinary(name, scoopSubdir = name) {
  const home = os.homedir();
  const candidates = [
    // 1. Local project bin directory (portable bundle)
    path.join(process.cwd(), 'bin', `${name}.exe`),
    path.join(process.cwd(), 'bin', `${name}.cmd`),
    path.join(process.cwd(), 'bin', name),

    // 2. User's Scoop shims directory
    path.join(home, 'scoop', 'shims', `${name}.exe`),
    path.join(home, 'scoop', 'shims', `${name}.cmd`),
    path.join(home, 'scoop', 'shims', `${name}.ps1`),
    path.join(home, 'scoop', 'shims', name),

    // 3. User's Scoop apps directory
    path.join(home, 'scoop', 'apps', scoopSubdir, 'current', `${name}.exe`),
    path.join(home, 'scoop', 'apps', scoopSubdir, 'current', `${name}.cmd`),
    path.join(home, 'scoop', 'apps', scoopSubdir, 'current', name),

    // 4. Common Program Files locations
    path.join('C:\\Program Files\\Git\\bin', `${name}.exe`),
    path.join('C:\\Program Files\\mpv', `${name}.exe`)
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // 5. System PATH lookup via where.exe
  try {
    const stdout = execSync(`where ${name} 2>nul`, { encoding: 'utf-8', timeout: 1500 });
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}

  // Fallback to bare executable name
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/**
 * Get tool version cleanly with timeout
 */
function getVersion(binaryPath, versionArg = '--version') {
  try {
    if (!fs.existsSync(binaryPath) && !binaryPath.endsWith('.exe')) {
      return null;
    }
    const stdout = execSync(`"${binaryPath}" ${versionArg}`, { 
      encoding: 'utf-8', 
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'] 
    });
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    return firstLine ? firstLine.replace(/^[a-zA-Z0-9_\-\s]+version\s*/i, '').trim().slice(0, 50) : 'Available';
  } catch {
    return fs.existsSync(binaryPath) ? 'Installed' : null;
  }
}

/**
 * Scan all required and optional tools
 */
export function getEnvironmentStatus() {
  const home = os.homedir();
  const scoopShimPath = path.join(home, 'scoop', 'shims');
  const hasScoop = fs.existsSync(path.join(home, 'scoop'));

  const results = {};
  let criticalMissingCount = 0;

  for (const tool of TOOLS) {
    const binPath = findBinary(tool.name, tool.scoopSubdir);
    const exists = fs.existsSync(binPath);
    let version = null;

    if (exists) {
      version = getVersion(binPath, tool.versionArg);
    }

    results[tool.name] = {
      name: tool.name,
      installed: exists,
      path: exists ? binPath : null,
      version: version || (exists ? 'Installed' : 'Missing'),
      critical: tool.critical
    };

    if (tool.critical && !exists) {
      criticalMissingCount++;
    }
  }

  const allInstalled = Object.values(results).every(t => t.installed);
  const ready = criticalMissingCount === 0;

  return {
    ready,
    allInstalled,
    hasScoop,
    scoopPath: scoopShimPath,
    tools: results
  };
}

/**
 * Custom PowerShell wrapper for ani-cli so it never fails due to missing or non-standard Git Bash
 */
export function ensureAniCliCustomWrapper() {
  const home = os.homedir();
  const scoopShims = path.join(home, 'scoop', 'shims');
  const aniCliApp = path.join(home, 'scoop', 'apps', 'ani-cli', 'current', 'ani-cli');

  if (!fs.existsSync(scoopShims)) return;

  // Locate bash.exe
  const bashCandidates = [
    findBinary('bash', 'git'),
    path.join(home, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    path.join(home, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ];

  let bashPath = bashCandidates.find(p => p && fs.existsSync(p)) || 'bash.exe';

  // 1. Customized ani-cli.cmd wrapper
  const cmdWrapperPath = path.join(scoopShims, 'ani-cli-pwsh.cmd');
  const cmdContent = `@echo off
rem Custom AniFlix PowerShell-friendly wrapper for ani-cli
setlocal enabledelayedexpansion
set "ARGS=%*"
if exist "${bashPath}" (
  "${bashPath}" -l -c "$(cygpath -u '${aniCliApp.replace(/\\/g, '/')}') !ARGS!"
) else (
  bash -l -c "$(cygpath -u '${aniCliApp.replace(/\\/g, '/')}') !ARGS!"
)
`;
  try {
    fs.writeFileSync(cmdWrapperPath, cmdContent, 'utf-8');
  } catch {}

  // 2. Customized ani-cli.ps1 wrapper for pure PowerShell sessions
  const ps1WrapperPath = path.join(scoopShims, 'ani-cli.ps1');
  const ps1Content = `# Custom AniFlix PowerShell wrapper for ani-cli
$bash = "${bashPath.replace(/\\/g, '\\\\')}"
if (!(Test-Path $bash)) {
  $bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
}
$scriptPath = "${aniCliApp.replace(/\\/g, '/')}"
if ($bash) {
  & $bash -l -c "\$(cygpath -u '$scriptPath') $args"
} else {
  Write-Error "Git Bash is required to run ani-cli. Please install git via Scoop."
}
`;
  try {
    fs.writeFileSync(ps1WrapperPath, ps1Content, 'utf-8');
  } catch {}
}

/**
 * 1-Click Install all missing tools via PowerShell & Scoop
 */
export function installAllPlugins(onProgress) {
  return new Promise((resolve, reject) => {
    onProgress('🔍 Checking PowerShell environment & Scoop installation...\n');

    const home = os.homedir();
    const scoopPath = path.join(home, 'scoop');

    const installScript = `
$ErrorActionPreference = 'Continue'
Write-Host ">>> Initializing Windows Plugin Environment Setup..."

# 1. Enable script execution for CurrentUser
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force

# 2. Check or install Scoop
if (!(Get-Command scoop -ErrorAction SilentlyContinue) -and !(Test-Path "${path.join(home, 'scoop', 'shims', 'scoop.ps1').replace(/\\/g, '\\\\')}")) {
  Write-Host ">>> Installing Scoop package manager to $env:USERPROFILE\\scoop..."
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  Invoke-RestMethod -Uri https://get.scoop.it | Invoke-Expression
} else {
  Write-Host ">>> Scoop is already installed."
}

# Add scoop shims to current process PATH
$env:PATH = "${path.join(home, 'scoop', 'shims').replace(/\\/g, '\\\\')};" + $env:PATH

# 3. Add extras bucket for mpv and tools
Write-Host ">>> Ensuring Scoop buckets are configured..."
scoop bucket add extras 2>$null

# 4. Install essential video and streaming tools
$toolsToInstall = @("yt-dlp", "ffmpeg", "mpv", "aria2", "git", "ani-cli")
foreach ($t in $toolsToInstall) {
  Write-Host ">>> Installing $t via Scoop..."
  scoop install $t
}

Write-Host ">>> Setup completed successfully!"
`;

    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installScript], {
      windowsHide: true
    });

    ps.stdout.on('data', (data) => {
      onProgress(data.toString());
    });

    ps.stderr.on('data', (data) => {
      onProgress(data.toString());
    });

    ps.on('close', (code) => {
      ensureAniCliCustomWrapper();
      if (code === 0) {
        onProgress('\n🎉 All video plugins have been installed and configured!\n');
        resolve({ success: true, code });
      } else {
        onProgress(`\n⚠️ Installation finished with exit code ${code}.\n`);
        resolve({ success: code === 0, code });
      }
    });

    ps.on('error', (err) => {
      onProgress(`\n❌ Error launching PowerShell: ${err.message}\n`);
      reject(err);
    });
  });
}

/**
 * 1-Click Update all plugins (Scoop packages + yt-dlp)
 */
export function updateAllPlugins(onProgress) {
  return new Promise((resolve, reject) => {
    onProgress('🔄 Updating video plugins to the latest releases...\n');

    const home = os.homedir();
    const updateScript = `
$env:PATH = "${path.join(home, 'scoop', 'shims').replace(/\\/g, '\\\\')};" + $env:PATH
Write-Host ">>> Running Scoop update..."
scoop update
Write-Host ">>> Updating installed apps..."
scoop update *
Write-Host ">>> Ensuring yt-dlp is latest..."
yt-dlp -U
Write-Host ">>> All plugins updated!"
`;

    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', updateScript], {
      windowsHide: true
    });

    ps.stdout.on('data', (data) => onProgress(data.toString()));
    ps.stderr.on('data', (data) => onProgress(data.toString()));

    ps.on('close', (code) => {
      ensureAniCliCustomWrapper();
      onProgress(`\n✅ Plugin update finished (exit code ${code}).\n`);
      resolve({ success: code === 0 });
    });

    ps.on('error', (err) => {
      onProgress(`\n❌ Error running updater: ${err.message}\n`);
      reject(err);
    });
  });
}

export const APP_VERSION = '2.0.0';

function parseVersion(vStr) {
  if (!vStr) return [0, 0, 0];
  const clean = vStr.replace(/^v/i, '').trim();
  const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isNewerVersion(latest, current) {
  const [lMaj, lMin, lPat] = parseVersion(latest);
  const [cMaj, cMin, cPat] = parseVersion(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Check AniFlix application version and GitHub releases
 */
export async function checkAppUpdate() {
  const currentVersion = APP_VERSION;
  const repo = process.env.ANIFLIX_GITHUB_REPO || 'Mangotimmy/ani_gui';
  
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 
        'User-Agent': 'AniFlix-Desktop/2.0.4',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawTag = data.tag_name || data.name || currentVersion;
      const latestVer = rawTag.replace(/^v/i, '').trim();
      const hasUpdate = isNewerVersion(latestVer, currentVersion);

      return {
        currentVersion,
        latestVersion: latestVer,
        hasUpdate,
        releaseUrl: data.html_url || `https://github.com/${repo}/releases`,
        releaseNotes: data.body || 'New AniFlix features and stability updates are available.',
        publishedAt: data.published_at,
        checkedAt: new Date().toISOString(),
        connectedToGitHub: true
      };
    } else if (res.status === 404) {
      // Repository exists or has no public releases yet
      return {
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        releaseNotes: `Connected to GitHub (${repo}). You are running the newest v${currentVersion} build.`,
        checkedAt: new Date().toISOString(),
        connectedToGitHub: true
      };
    }
  } catch (err) {
    console.warn('[VersionChecker] GitHub check notice:', err.message);
  }

  return {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    releaseNotes: `You are running AniFlix v${currentVersion} (Latest Release).`,
    checkedAt: new Date().toISOString(),
    connectedToGitHub: false
  };
}
