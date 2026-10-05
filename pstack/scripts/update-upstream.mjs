import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owner = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const source = realpathSync(process.cwd());
let repository;
let initialHead;
let stage;
let branch;

function run(command, args, cwd = repository ?? source) {
  if (command === 'git') args = ['-c', 'core.hooksPath=/dev/null', ...args];
  // Also disable hooks for Git invoked by the reviewed checks.
  const count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  const env = { ...process.env, GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${count}`]: '/dev/null' };
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  return { ...result, ok: !result.error && result.status === 0 };
}

function git(args, cwd) {
  const result = run('git', args, cwd);
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.error?.message || result.stderr.trim()}`);
  return result.stdout.trim();
}

function assertClean() {
  if (git(['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Entire source repository must be clean, including untracked files. Save intended local work before retrying.');
  }
  for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (existsSync(git(['rev-parse', '--path-format=absolute', '--git-path', state]))) {
      throw new Error(`Source has an ongoing merge/rebase (${state}). Finish it before retrying.`);
    }
  }
}

function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function check(command, args, cwd, label) {
  const result = run(command, args, cwd);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.ok) console.error(`${label}: BLOCKED (${result.error?.message || `exit ${result.status}`}).`);
  return result.ok;
}

function reviewFiles(changed) {
  const files = [];
  for (const file of changed) {
    const name = basename(file);
    const oldMode = git(['ls-tree', initialHead, '--', file]).split(' ')[0];
    const target = join(stage, file);
    const stat = existsSync(target) ? lstatSync(target) : undefined;
    const executable = oldMode === '100755' || oldMode === '120000' || stat?.isSymbolicLink() || (stat && (stat.mode & 0o111));
    if (executable) { files.push(file); continue; }
    if (name === 'package.json') {
      const before = git(['ls-tree', initialHead, '--', file]);
      const after = existsSync(join(stage, file));
      if (!before || !after) { files.push(`${file} (package added/removed)`); continue; }
      const oldPackage = JSON.parse(git(['show', `${initialHead}:${file}`]));
      const newPackage = JSON.parse(readFileSync(join(stage, file), 'utf8'));
      delete oldPackage.version;
      delete newPackage.version;
      if (JSON.stringify(oldPackage) !== JSON.stringify(newPackage)) files.push(`${file} (changes beyond version)`);
      continue;
    }
    const script = /(?:^|\/)scripts\//.test(file) || /\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|fish|ps1|rb|pl|cmd|bat|exe|wasm|so|dll)$/i.test(file);
    const npmConfig = ['.npmrc', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc', '.yarnrc.yml'].includes(name);
    // Catch extensionless scripts even when upstream omitted the executable bit.
    const shebang = !script && !npmConfig && (
      (stat?.isFile() && readFileSync(target).subarray(0, 2).toString() === '#!') ||
      (oldMode === '100644' && git(['show', `${initialHead}:${file}`]).startsWith('#!'))
    );
    if (script || npmConfig || shebang) files.push(file);
  }
  return files;
}

function main() {
  // Reject wrong cwd before even inspecting Git; the updater belongs to this component.
  if (source !== owner) throw new Error('Run from the canonical pstack component directory owning this updater, not the repository root or another checkout.');
  repository = realpathSync(git(['rev-parse', '--show-toplevel'], source));
  if (basename(source) !== 'pstack' || dirname(source) !== repository || realpathSync(join(repository, 'pstack')) !== source) {
    throw new Error('The owning component must be pstack/ directly inside the discovered Git repository root.');
  }
  assertClean();
  initialHead = git(['rev-parse', 'HEAD']);
  const url = git(['remote', 'get-url', 'upstream']);
  if (!url) throw new Error('The upstream remote must have a fetch URL.');
  console.log(`Fetching configured upstream remote: ${url}`);
  git(['fetch', 'upstream']);
  // Ask the live remote; missing or stale upstream/HEAD is never a reason to guess main.
  git(['remote', 'set-head', 'upstream', '--auto']);
  const ref = git(['symbolic-ref', '--quiet', 'refs/remotes/upstream/HEAD']);
  if (!ref.startsWith('refs/remotes/upstream/')) throw new Error(`Unexpected upstream default ref: ${ref}`);
  const target = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (git(['rev-list', '--count', `${initialHead}..${target}`]) === '0') {
    console.log('Already up to date: no upstream-only commits. No staging worktree created.');
    return;
  }
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  branch = `update-upstream/${id}`;
  const candidate = join(dirname(repository), `${basename(repository)}-upstream-${id}`);
  git(['worktree', 'add', '-b', branch, candidate, initialHead]);
  stage = candidate;
  console.log(`Staging worktree: ${stage}\nStaging branch: ${branch}`);
  const merge = run('git', ['merge', '--no-commit', '--no-ff', target], stage);
  if (merge.stdout) process.stdout.write(merge.stdout);
  if (merge.stderr) process.stderr.write(merge.stderr);
  if (!merge.ok) {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U'], stage);
    throw new Error(conflicts ? `Merge conflicts retained in staging:\n${conflicts}\nResolve them there without blindly choosing ours or theirs, then review scope and code before checks.` : 'Staging merge failed; worktree retained for inspection.');
  }
  const changed = git(['diff', '--name-only', initialHead], stage).split('\n').filter(Boolean);
  const outside = changed.filter(file => !file.startsWith('pstack/'));
  if (outside.length) throw new Error(`Broader scope blocker: upstream changes outside pstack/:\n${outside.join('\n')}\nNo staging checks were run. Review and obtain broader scope authorization before continuing.`);
  const review = reviewFiles(changed);
  if (review.length) throw new Error(`Review changed validation/executable code before running staging checks:\n${review.join('\n')}\nNo upstream code was run. Review first, then run checks manually in the retained staging pstack directory.`);
  const stagedComponent = join(stage, 'pstack');
  const blockers = [];
  if (!check('npm', ['run', 'check'], stagedComponent, 'Component checks')) blockers.push('component checks');
  if (!check('npm', ['test'], stagedComponent, 'Regression tests')) blockers.push('regression tests');
  if (!check('git', ['diff', '--check', initialHead], stage, 'Diff whitespace checks')) blockers.push('diff whitespace checks');
  const adoption = join(homedir(), '.pi', 'agent', 'lib', 'skill-adoption.mjs');
  if (!existsSync(adoption)) {
    console.error(`Activation blocker: installed adoption checker missing at ${adoption}`);
    blockers.push('activation: adoption checker missing');
  } else if (!check(process.execPath, [adoption, 'check', '--cwd', source], source, 'Original component adoption check')) {
    blockers.push('activation: adoption check failed');
  }
  if (changed.includes('pstack/.cursor-plugin/plugin.json')) {
    console.log('Cursor manifest changed: component checks cover JSON and local invariants, not Cursor runtime/plugin validation. Review in Cursor before activation; no Claude strict validator applies.');
  }
  if (blockers.length) throw new Error(`Staging blocked: ${blockers.join('; ')}.`);
  console.log('Staging checks passed. This is local preparation, not activation or workflow qualification. Review the uncommitted merge before any separately authorized integration.');
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (stage) {
    console.log(`Retained staging worktree: ${stage}\nInspect: git -C ${quote(stage)} status\nReview: git -C ${quote(stage)} diff HEAD\nAfter scope/code review: cd ${quote(join(stage, 'pstack'))} && npm run check && npm test && git diff --check\nNothing was committed, applied to the source checkout, installed, trusted, lock-reset, or pushed.`);
  }
  if (initialHead) {
    try {
      if (git(['rev-parse', 'HEAD']) !== initialHead) throw new Error('Source HEAD changed during staging. Do not integrate this result until reviewed.');
      assertClean();
    } catch (error) { console.error(`Concurrent source change blocker: ${error.message}`); process.exitCode = 1; }
  }
}
