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

function bumpSemver(current, type) {
  const parts = current.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);

  let [major, minor, patch] = parts;
  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else if (type === 'patch') {
    patch += 1;
  } else {
    throw new Error(`Unknown bump type: ${type}`);
  }
  return `${major}.${minor}.${patch}`;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}AniFlix Git Auto Push & Tag Script${colors.reset}

${colors.bright}USAGE:${colors.reset}
  npm run release [version|bump] [options]
  node scripts/release.mjs [version|bump] [options]

${colors.bright}ARGUMENTS:${colors.reset}
  patch               Increment patch version (e.g. 2.7.0 -> 2.7.1)
  minor               Increment minor version (e.g. 2.7.0 -> 2.8.0)
  major               Increment major version (e.g. 2.7.0 -> 3.0.0)
  <version>           Explicit semver (e.g. 2.7.0 or v2.7.0)
  (none)              Use the version currently defined in package.json

${colors.bright}OPTIONS:${colors.reset}
  -m, --message <msg> Custom commit message
  -r, --remote <name> Git remote name (default: origin)
  -d, --dry-run       Preview commands without modifying git or pushing
  --no-commit         Do not create a git commit; only tag and push
  --no-push           Create commit and tag, but do not git push
  -h, --help          Show this help message

${colors.bright}EXAMPLES:${colors.reset}
  npm run release                      # Auto-stage, commit, tag current version, and push
  npm run release patch                # Bump patch, commit, tag, and push
  npm run release minor                # Bump minor, commit, tag, and push
  npm run release 2.8.0                # Set version 2.8.0, commit, tag, and push
  npm run release -- -m "feat: updates" # Custom commit message
  npm run release -- --dry-run         # Dry run preview
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

  let remote = 'origin';
  const remoteIdx = rawArgs.findIndex(a => a === '-r' || a === '--remote');
  if (remoteIdx !== -1 && rawArgs[remoteIdx + 1]) {
    remote = rawArgs[remoteIdx + 1];
  }

  let customMessage = '';
  const msgIdx = rawArgs.findIndex(a => a === '-m' || a === '--message');
  if (msgIdx !== -1 && rawArgs[msgIdx + 1]) {
    customMessage = rawArgs[msgIdx + 1];
  }

  const positional = rawArgs.filter(a => !a.startsWith('-') && a !== remote && a !== customMessage);
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
  const remotes = runGit('git remote', { silent: true }).split(/\r?\n/).map(s => s.trim());
  if (!remotes.includes(remote)) {
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

  if (['patch', 'minor', 'major'].includes(bumpArg.toLowerCase())) {
    targetVersion = bumpSemver(currentVersion, bumpArg.toLowerCase());
    log(`Bumping version (${bumpArg}): ${colors.yellow}${currentVersion}${colors.reset} -> ${colors.green}${targetVersion}${colors.reset}`);
  } else if (bumpArg) {
    targetVersion = bumpArg.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+.*$/.test(targetVersion)) {
      logError(`Invalid semver format: "${bumpArg}". Expected format: X.Y.Z (e.g. 2.7.0)`);
      process.exit(1);
    }
    log(`Setting version: ${colors.green}${targetVersion}${colors.reset}`);
  } else {
    log(`Using current version: ${colors.green}${targetVersion}${colors.reset}`);
  }

  // Update package.json and package-lock.json if version changed
  if (targetVersion !== currentVersion) {
    if (!isDryRun) {
      pkg.version = targetVersion;
      fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      logSuccess(`Updated package.json to ${targetVersion}`);

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
      log(`[Dry-Run] Would update package.json version to ${targetVersion}`);
    }
  }

  const tagName = `v${targetVersion}`;

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

  // Extract commit notes from previous tag
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
    if (commitNotes) {
      log(`\n${colors.cyan}Release Notes (Commits):${colors.reset}`);
      console.log(commitNotes.split('\n').map(l => `  ${l}`).join('\n') + '\n');
    }
  } catch (err) {
    // Non-fatal
  }

  const existingTags = runGit(`git tag -l "${tagName}"`, { silent: true });
  const tagExists = existingTags.split(/\r?\n/).some(t => t.trim() === tagName);

  if (tagExists) {
    logWarn(`Git tag "${tagName}" already exists.`);
    // Check if the tag points to current HEAD
    const headHash = runGit('git rev-parse HEAD', { silent: true, ignoreError: true });
    const tagHash = runGit(`git rev-parse "${tagName}^{commit}"`, { silent: true, ignoreError: true });
    if (headHash === tagHash) {
      logSuccess(`Tag "${tagName}" is already pointing to current HEAD.`);
    } else {
      logWarn(`Tag "${tagName}" points to commit ${tagHash?.slice(0, 7)}, HEAD is ${headHash?.slice(0, 7)}.`);
    }
  } else {
    const fullTagMsg = `Release ${tagName}${commitNotes ? `\n\nCommits in this release:\n${commitNotes}` : ''}`;
    if (!isDryRun) {
      const tempMsgPath = path.join(ROOT_DIR, '.tmp_tag_msg.txt');
      try {
        fs.writeFileSync(tempMsgPath, fullTagMsg, 'utf-8');
        runGit(`git tag -a "${tagName}" -F "${tempMsgPath}"`);
      } finally {
        if (fs.existsSync(tempMsgPath)) fs.unlinkSync(tempMsgPath);
      }
      logSuccess(`Created annotated git tag: ${colors.green}${tagName}${colors.reset}`);
    } else {
      log(`[Dry-Run] Would run: git tag -a "${tagName}" with commit notes`);
    }
  }

  // 5. Git Push (Branch and Tag)
  logStep('5/5', 'Pushing to remote repository...');
  if (noPush) {
    logWarn('--no-push specified. Skipping push to remote.');
  } else {
    if (!isDryRun) {
      log(`Pushing branch ${colors.cyan}${currentBranch}${colors.reset} to ${remote}...`);
      try {
        const pushBranchRes = runGit(`git push ${remote} ${currentBranch}`);
        if (pushBranchRes) console.log(pushBranchRes);
        logSuccess(`Branch ${currentBranch} pushed to ${remote}.`);
      } catch (err) {
        logError(`Failed to push branch: ${err.message}`);
        process.exit(1);
      }

      log(`Pushing tag ${colors.green}${tagName}${colors.reset} to ${remote}...`);
      try {
        const pushTagRes = runGit(`git push ${remote} "${tagName}"`);
        if (pushTagRes) console.log(pushTagRes);
        logSuccess(`Tag ${tagName} pushed to ${remote}.`);
      } catch (err) {
        logError(`Failed to push tag: ${err.message}`);
        process.exit(1);
      }
    } else {
      log(`[Dry-Run] Would run: git push ${remote} ${currentBranch}`);
      log(`[Dry-Run] Would run: git push ${remote} "${tagName}"`);
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
