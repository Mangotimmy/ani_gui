#!/usr/bin/env node
// scripts/release.mjs - Git Auto Push, Tag, and Release Notes Automation Script
// Automates: version bump -> git stage/commit -> git tag (with commit notes) -> git push (branch & tags)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PKG_PATH = path.join(ROOT_DIR, 'package.json');
const PKG_LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json');

// Terminal ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  console.log(`${colors.cyan}[${step}]${colors.reset} ${colors.bright}${msg}${colors.reset}`);
}

function logSuccess(msg) {
  console.log(`${colors.green}✔ ${msg}${colors.reset}`);
}

function logWarn(msg) {
  console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
}

function logError(msg) {
  console.error(`${colors.red}✖ ${msg}${colors.reset}`);
}

function runGit(cmd, options = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'pipe',
      ...options
    }).trim();
  } catch (err) {
    if (options.ignoreError) return '';
    throw err;
  }
}

function bumpSemver(current, type, preid = 'beta') {
  const clean = current.replace(/^v/, '');
  const [corePart, prePart] = clean.split('-');
  const parts = corePart.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);

  let [major, minor, patch] = parts;
  const t = type.toLowerCase();
  if (t === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
    return `${major}.${minor}.${patch}`;
  } else if (t === 'minor') {
    minor += 1;
    patch = 0;
    return `${major}.${minor}.${patch}`;
  } else if (t === 'patch') {
    patch += 1;
    return `${major}.${minor}.${patch}`;
  } else if (t === 'prerelease' || t === 'prepatch' || t === 'preminor' || t === 'premajor') {
    if (t === 'premajor') {
      major += 1; minor = 0; patch = 0;
      return `${major}.${minor}.${patch}-${preid}.1`;
    }
    if (t === 'preminor') {
      minor += 1; patch = 0;
      return `${major}.${minor}.${patch}-${preid}.1`;
    }
    if (t === 'prepatch') {
      patch += 1;
      return `${major}.${minor}.${patch}-${preid}.1`;
    }
    // prerelease
    if (prePart) {
      const m = prePart.match(/^([a-zA-Z0-9_-]+?)(?:\.(\d+))?$/);
      if (m && m[1] === preid) {
        const nextNum = (parseInt(m[2] || '0', 10) || 0) + 1;
        return `${major}.${minor}.${patch}-${preid}.${nextNum}`;
      }
      return `${major}.${minor}.${patch}-${preid}.1`;
    }
    patch += 1;
    return `${major}.${minor}.${patch}-${preid}.1`;
  } else {
    throw new Error(`Unknown bump type: ${type}`);
  }
}

export function updateVersionFiles(targetVersion, { isDryRun = false, updateChangelog = false, commitNotes = '' } = {}) {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const currentVersion = pkg.version || '1.0.0';

  if (targetVersion !== currentVersion) {
    if (!isDryRun) {
      pkg.version = targetVersion;
      fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      logSuccess(`Updated package.json: ${currentVersion} -> ${targetVersion}`);

      if (fs.existsSync(PKG_LOCK_PATH)) {
        try {
          const pkgLock = JSON.parse(fs.readFileSync(PKG_LOCK_PATH, 'utf-8'));
          pkgLock.version = targetVersion;
          if (pkgLock.packages && pkgLock.packages['']) {
            pkgLock.packages[''].version = targetVersion;
          }
          fs.writeFileSync(PKG_LOCK_PATH, JSON.stringify(pkgLock, null, 2) + '\n', 'utf-8');
          logSuccess(`Updated package-lock.json to ${targetVersion}`);
        } catch (e) {
          logWarn(`Could not update package-lock.json: ${e.message}`);
        }
      }
    } else {
      log(`[Dry-Run] Would update package.json & package-lock.json: ${currentVersion} -> ${targetVersion}`);
    }
  }

  if (updateChangelog) {
    const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');
    const dateStr = new Date().toISOString().slice(0, 10);
    const notesBlock = commitNotes && commitNotes.trim()
      ? commitNotes.trim()
      : `- Release v${targetVersion}`;
    const newSection = `## ${targetVersion} (${dateStr})\n\n${notesBlock}\n\n`;

    if (!isDryRun) {
      if (fs.existsSync(changelogPath)) {
        const existing = fs.readFileSync(changelogPath, 'utf-8');
        if (!existing.includes(`## ${targetVersion}`)) {
          const updated = existing.startsWith('# Changelog')
            ? existing.replace(/^# Changelog\r?\n+/, `# Changelog\n\n${newSection}`)
            : `# Changelog\n\n${newSection}${existing}`;
          fs.writeFileSync(changelogPath, updated, 'utf-8');
          logSuccess(`Updated CHANGELOG.md with section ## ${targetVersion}`);
        }
      } else {
        fs.writeFileSync(changelogPath, `# Changelog\n\n${newSection}`, 'utf-8');
        logSuccess(`Created CHANGELOG.md with section ## ${targetVersion}`);
      }
    } else {
      log(`[Dry-Run] Would prepend ## ${targetVersion} (${dateStr}) to CHANGELOG.md`);
    }
  }

  return { previousVersion: currentVersion, targetVersion };
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}AniFlix Git Auto Push & Tag Script${colors.reset}

${colors.bright}USAGE:${colors.reset}
  npm run release [version|bump] [options]
  node scripts/release.mjs [version|bump] [options]
  .\\scripts\\git-push-tag.ps1 [-Gui | -Tui | options]

${colors.bright}ARGUMENTS:${colors.reset}
  patch               Increment patch version (e.g. 2.7.5 -> 2.7.6)
  minor               Increment minor version (e.g. 2.7.5 -> 2.8.0)
  major               Increment major version (e.g. 2.7.5 -> 3.0.0)
  prerelease          Increment pre-release version (e.g. 2.7.6-beta.1)
  prepatch|preminor|premajor  Bump and start pre-release tag
  <version>           Explicit semver (e.g. 2.8.0 or v2.8.0-rc.1)
  (none)              Use the version currently defined in package.json

${colors.bright}OPTIONS:${colors.reset}
  -m, --message <msg> Custom commit message
  -r, --remote <name> Git remote name (default: origin)
  --preid <id>        Pre-release identifier: alpha, beta, rc, next (default: beta)
  --version-only      Only update version in package.json/package-lock.json/CHANGELOG.md
  --changelog         Prepend release notes section to CHANGELOG.md
  --force-tag         Overwrite existing git tag (-f) if it already exists
  --force-push        Push with --force-with-lease
  --pull-rebase       Run git pull --rebase before pushing
  --build             Run frontend production build (vite build) before committing
  -d, --dry-run       Preview commands without modifying git or pushing
  --no-commit         Do not create a git commit; only tag and push
  --no-tag            Do not create a git tag
  --no-push           Create commit and tag, but do not git push
  -h, --help          Show this help message
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const isDryRun = rawArgs.includes('-d') || rawArgs.includes('--dry-run');
  const noPush = rawArgs.includes('--no-push');
  const noCommit = rawArgs.includes('--no-commit');
  const noTag = rawArgs.includes('--no-tag');
  const versionOnly = rawArgs.includes('--version-only');
  const updateChangelog = rawArgs.includes('--changelog');
  const forceTag = rawArgs.includes('--force-tag');
  const forcePush = rawArgs.includes('--force-push');
  const pullRebase = rawArgs.includes('--pull-rebase');
  const buildFirst = rawArgs.includes('--build');

  let remote = 'origin';
  const remoteIdx = rawArgs.findIndex(a => a === '-r' || a === '--remote');
  if (remoteIdx !== -1 && rawArgs[remoteIdx + 1]) {
    remote = rawArgs[remoteIdx + 1];
  }

  let preid = 'beta';
  const preidIdx = rawArgs.findIndex(a => a === '--preid');
  if (preidIdx !== -1 && rawArgs[preidIdx + 1]) {
    preid = rawArgs[preidIdx + 1];
  }

  let customMessage = '';
  const msgIdx = rawArgs.findIndex(a => a === '-m' || a === '--message');
  if (msgIdx !== -1 && rawArgs[msgIdx + 1]) {
    customMessage = rawArgs[msgIdx + 1];
  }

  const consumedValues = new Set([remote, customMessage, preid].filter(Boolean));
  const positional = rawArgs.filter(a => !a.startsWith('-') && !consumedValues.has(a));
  const bumpArg = positional[0] ? positional[0].trim() : '';

  log(`\n${colors.bright}${colors.magenta}=== AniFlix Git Auto Push, Tag & Release Tool ===${colors.reset}\n`);

  if (isDryRun) {
    logWarn('DRY-RUN MODE ENABLED: No changes will be written or pushed.\n');
  }

  // 1. Check Git environment
  logStep('1/5', 'Checking Git repository...');
  try {
    const isInsideWorkTree = runGit('git rev-parse --is-inside-work-tree', { silent: true });
    if (isInsideWorkTree !== 'true') throw new Error();
  } catch {
    logError('Not inside a valid Git repository.');
    process.exit(1);
  }

  const currentBranch = runGit('git branch --show-current', { silent: true }) || 'master';
  logSuccess(`Current Git branch: ${colors.cyan}${currentBranch}${colors.reset}`);

  // Check remote
  const remotes = runGit('git remote', { silent: true }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (remotes.length > 0 && !remotes.includes(remote)) {
    logWarn(`Remote "${remote}" not found in remotes (${remotes.join(', ')}).`);
    remote = remotes[0] || 'origin';
    log(`Falling back to remote "${remote}".`);
  }

  // 2. Determine Version
  logStep('2/5', 'Resolving version...');
  if (!fs.existsSync(PKG_PATH)) {
    logError('package.json not found in root.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const currentVersion = pkg.version || '1.0.0';
  let targetVersion = currentVersion;

  const bumpTypes = ['patch', 'minor', 'major', 'prerelease', 'prepatch', 'preminor', 'premajor'];
  if (bumpTypes.includes(bumpArg.toLowerCase())) {
    targetVersion = bumpSemver(currentVersion, bumpArg.toLowerCase(), preid);
    log(`Bumping version (${bumpArg}): ${colors.yellow}${currentVersion}${colors.reset} -> ${colors.green}${targetVersion}${colors.reset}`);
  } else if (bumpArg && bumpArg.toLowerCase() !== 'keep') {
    targetVersion = bumpArg.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+.*$/.test(targetVersion)) {
      logError(`Invalid semver format: "${bumpArg}". Expected format: X.Y.Z (e.g. 2.7.0)`);
      process.exit(1);
    }
    log(`Setting version: ${colors.green}${targetVersion}${colors.reset}`);
  } else {
    log(`Using current version: ${colors.green}${targetVersion}${colors.reset}`);
  }

  const tagName = `v${targetVersion}`;

  // Extract commit notes from previous tag early so CHANGELOG.md and tag can both use them
  let commitNotes = '';
  try {
    const allTags = runGit('git tag --sort=-creatordate', { silent: true, ignoreError: true })
      .split(/\r?\n/)
      .map(t => t.trim())
      .filter(t => t && t !== tagName);
    const prevTag = allTags[0];
    if (prevTag) {
      log(`Previous tag detected: ${colors.yellow}${prevTag}${colors.reset}`);
      commitNotes = runGit(`git log --pretty=format:"* %s (%h)" "${prevTag}..HEAD"`, { silent: true, ignoreError: true });
    } else {
      commitNotes = runGit('git log --pretty=format:"* %s (%h)" -n 30', { silent: true, ignoreError: true });
    }
  } catch {}

  updateVersionFiles(targetVersion, { isDryRun, updateChangelog, commitNotes });

  if (versionOnly) {
    logSuccess(`Version update complete (${currentVersion} -> ${targetVersion}). Exiting (--version-only).`);
    return;
  }

  if (buildFirst) {
    logStep('Build', 'Running production build (vite build)...');
    if (!isDryRun) {
      execSync('node ./node_modules/vite/bin/vite.js build', { cwd: ROOT_DIR, stdio: 'inherit' });
      logSuccess('Production build succeeded.');
    } else {
      log('[Dry-Run] Would run: vite build');
    }
  }

  // 3. Stage & Commit Changes
  logStep('3/5', 'Checking working tree & committing...');
  const statusOutput = runGit('git status --porcelain', { silent: true });
  const hasChanges = statusOutput.length > 0;

  if (hasChanges && !noCommit) {
    const commitMsg = customMessage || `chore(release): ${tagName}`;
    log(`Uncommitted changes detected. Staging all files...`);
    if (!isDryRun) {
      runGit('git add -A');
      runGit(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
      logSuccess(`Committed changes: "${commitMsg}"`);
    } else {
      log(`[Dry-Run] Would run: git add -A && git commit -m "${commitMsg}"`);
    }
  } else if (!hasChanges) {
    logSuccess('Working directory is clean.');
  } else {
    logWarn('--no-commit specified. Skipping commit of working directory changes.');
  }

  // 4. Git Tag & Commit Notes
  logStep('4/5', `Checking and creating git tag "${tagName}"...`);
  if (noTag) {
    logWarn('--no-tag specified. Skipping tag creation.');
  } else {
    if (commitNotes) {
      log(`\n${colors.cyan}Release Notes (Commits):${colors.reset}`);
      console.log(commitNotes.split('\n').map(l => `  ${l}`).join('\n') + '\n');
    }

    const existingTags = runGit(`git tag -l "${tagName}"`, { silent: true });
    const tagExists = existingTags.split(/\r?\n/).some(t => t.trim() === tagName);

    if (tagExists && !forceTag) {
      logWarn(`Git tag "${tagName}" already exists (use --force-tag to overwrite).`);
      const headHash = runGit('git rev-parse HEAD', { silent: true, ignoreError: true });
      const tagHash = runGit(`git rev-parse "${tagName}^{commit}"`, { silent: true, ignoreError: true });
      if (headHash === tagHash) {
        logSuccess(`Tag "${tagName}" is already pointing to current HEAD.`);
      } else {
        logWarn(`Tag "${tagName}" points to commit ${tagHash?.slice(0, 7)}, HEAD is ${headHash?.slice(0, 7)}.`);
      }
    } else {
      const fullTagMsg = `Release ${tagName}${commitNotes ? `\n\nCommits in this release:\n${commitNotes}` : ''}`;
      const forceFlag = forceTag ? '-f ' : '';
      if (!isDryRun) {
        const tempMsgPath = path.join(ROOT_DIR, '.tmp_tag_msg.txt');
        try {
          fs.writeFileSync(tempMsgPath, fullTagMsg, 'utf-8');
          runGit(`git tag -a ${forceFlag}"${tagName}" -F "${tempMsgPath}"`);
        } finally {
          if (fs.existsSync(tempMsgPath)) fs.unlinkSync(tempMsgPath);
        }
        logSuccess(`${tagExists ? 'Updated' : 'Created'} annotated git tag: ${colors.green}${tagName}${colors.reset}`);
      } else {
        log(`[Dry-Run] Would run: git tag -a ${forceFlag}"${tagName}" with commit notes`);
      }
    }
  }

  // 5. Git Push (Branch and Tag)
  logStep('5/5', 'Pushing to remote repository...');
  if (noPush) {
    logWarn('--no-push specified. Skipping push to remote.');
  } else {
    if (pullRebase) {
      log(`Pulling latest changes with --rebase from ${remote}/${currentBranch}...`);
      if (!isDryRun) {
        runGit(`git pull --rebase ${remote} ${currentBranch}`);
        logSuccess(`Rebased onto ${remote}/${currentBranch}.`);
      } else {
        log(`[Dry-Run] Would run: git pull --rebase ${remote} ${currentBranch}`);
      }
    }

    const pushForceFlag = forcePush ? '--force-with-lease ' : '';
    const tagForceFlag = (forceTag || forcePush) ? '--force ' : '';

    if (!isDryRun) {
      log(`Pushing branch ${colors.cyan}${currentBranch}${colors.reset} to ${remote}...`);
      try {
        const pushBranchRes = runGit(`git push ${pushForceFlag}${remote} ${currentBranch}`);
        if (pushBranchRes) console.log(pushBranchRes);
        logSuccess(`Branch ${currentBranch} pushed to ${remote}.`);
      } catch (err) {
        logError(`Failed to push branch: ${err.message}`);
        process.exit(1);
      }

      if (!noTag) {
        log(`Pushing tag ${colors.green}${tagName}${colors.reset} to ${remote}...`);
        try {
          const pushTagRes = runGit(`git push ${tagForceFlag}${remote} "${tagName}"`);
          if (pushTagRes) console.log(pushTagRes);
          logSuccess(`Tag ${tagName} pushed to ${remote}.`);
        } catch (err) {
          logError(`Failed to push tag: ${err.message}`);
          process.exit(1);
        }
      }
    } else {
      log(`[Dry-Run] Would run: git push ${pushForceFlag}${remote} ${currentBranch}`);
      if (!noTag) log(`[Dry-Run] Would run: git push ${tagForceFlag}${remote} "${tagName}"`);
    }
  }

  log(`\n${colors.bright}${colors.green}====================================================${colors.reset}`);
  log(`${colors.bright}${colors.green}  🎉 Release ${tagName} Completed Successfully!       ${colors.reset}`);
  log(`${colors.bright}${colors.green}====================================================${colors.reset}`);
  log(`\n${colors.cyan}Automated GitHub Actions Triggers:${colors.reset}`);
  log(`  Because tag ${colors.green}${tagName}${colors.reset} was pushed:`);
  log(`  1. ${colors.bright}.github/workflows/docker.yml${colors.reset}`);
  log(`     - Builds & publishes Docker images with tag ${colors.blue}${tagName}${colors.reset} and ${colors.blue}latest${colors.reset}`);
  log(`  2. ${colors.bright}.github/workflows/deploy.yml${colors.reset}`);
  log(`     - Builds & pushes Docker Hub images with metadata tags`);
  log(`  3. ${colors.bright}.github/workflows/release.yml${colors.reset}`);
  log(`     - Creates GitHub Release with ${colors.bright}Release notes from commit${colors.reset}`);
  log(`     - Builds & publishes cross-platform Electron binaries (Win/Mac/Linux)\n`);
}

main().catch(err => {
  logError(`Unhandled release error: ${err.message || err}`);
  process.exit(1);
});
