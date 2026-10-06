import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, createRunner, displayPaths, finishEvidence, nulPaths, quote, reviewFiles, runCheck } from './lib/fork-updater.mjs';

const owner = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const source = realpathSync(process.cwd());
const adoption = join(homedir(), '.pi', 'agent', 'lib', 'skill-adoption.mjs');
let repository;
let initialHead;
let initialBranch;
let stage;
const { run, git, gitRaw, gitPath } = createRunner(() => repository ?? source);
const evidence = {
  status: 'activation-blocked',
  source: { component: source, repository: null, branch: null, head: null },
  target: null,
  stage: null,
  stageBranch: null,
  checks: [],
  notRun: ['Component checks', 'Regression tests', 'Diff whitespace checks', 'Original component adoption check'],
  prerequisites: [],
};

function assertClean() {
  if (gitRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'])) {
    throw new Error('Entire source repository must be clean, including untracked files. Save intended local work before retrying.');
  }
  for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) {
    if (existsSync(gitPath(['rev-parse', '--path-format=absolute', '--git-path', state]))) {
      throw new Error(`Source has an ongoing merge/rebase/cherry-pick/revert operation (${state}). Finish it before retrying.`);
    }
  }
}

function check(command, args, cwd, label) {
  evidence.notRun = evidence.notRun.filter(name => name !== label);
  return runCheck(run, evidence, command, args, cwd, label);
}

function block(status, message) {
  evidence.status = status;
  evidence.prerequisites.push(message);
  throw new Error(message);
}

function main() {
  // Reject wrong cwd before even inspecting Git; the updater belongs to this component.
  if (source !== owner) throw new Error('Run from the canonical pstack component directory owning this updater, not the repository root or another checkout.');
  repository = realpathSync(gitPath(['rev-parse', '--show-toplevel'], source));
  evidence.source.repository = repository;
  if (basename(source) !== 'pstack' || dirname(source) !== repository || realpathSync(join(repository, 'pstack')) !== source) {
    throw new Error('The owning component must be pstack/ directly inside the discovered Git repository root.');
  }
  assertClean();
  initialHead = git(['rev-parse', 'HEAD']);
  initialBranch = gitPath(['rev-parse', '--symbolic-full-name', 'HEAD']);
  evidence.source.head = initialHead;
  evidence.source.branch = initialBranch;
  // Remote output (including get-url stdout) is intentionally suppressed by the shared runner.
  if (!run('git', ['remote', 'get-url', 'upstream']).ok) throw new Error('git remote get-url upstream failed: configure the upstream fetch remote.');
  console.log('Fetching configured upstream remote: upstream');
  git(['fetch', 'upstream']);
  // Ask the live remote; missing or stale upstream/HEAD is never a reason to guess main.
  git(['remote', 'set-head', 'upstream', '--auto']);
  const ref = gitPath(['symbolic-ref', '--quiet', 'refs/remotes/upstream/HEAD']);
  if (!ref.startsWith('refs/remotes/upstream/')) throw new Error(`Unexpected upstream default ref: ${ref}`);
  const target = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  evidence.target = { ref, head: target };
  if (git(['rev-list', '--count', `${initialHead}..${target}`]) === '0') {
    evidence.status = 'already-current';
    console.log('Already up to date: no upstream-only commits. No staging worktree created.');
    return;
  }
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const branch = `update-upstream/${id}`;
  const candidate = join(dirname(repository), `${basename(repository)}-upstream-${id}`);
  git(['worktree', 'add', '-b', branch, candidate, initialHead]);
  stage = candidate;
  evidence.stage = stage;
  evidence.stageBranch = branch;
  console.log(`Staging worktree: ${stage}\nStaging branch: ${branch}`);
  const merge = run('git', ['merge', '--no-commit', '--no-ff', target], stage);
  if (merge.stdout) process.stdout.write(merge.stdout);
  if (merge.stderr) process.stderr.write(merge.stderr);
  if (!merge.ok) {
    const conflicts = nulPaths(gitRaw(['diff', '--name-only', '-z', '--diff-filter=U'], stage));
    block(conflicts.length ? 'conflict' : 'activation-blocked', conflicts.length
      ? `Merge conflicts retained in staging:\n${displayPaths(conflicts)}\nResolve them there without blindly choosing ours or theirs, then review scope and code before checks.`
      : 'Staging merge failed; worktree retained for inspection.');
  }
  const changes = changedFiles(gitRaw, initialHead, stage);
  const paths = changes.map(change => change.path);
  // Preserve the compatibility limit without imposing a non-Pi activation gate.
  if (paths.includes('pstack/.cursor-plugin/plugin.json')) {
    console.log('Cursor manifest changed: component checks cover JSON and local invariants, not Cursor runtime/plugin validation. Cursor compatibility is unverified; no Cursor or Claude runtime validation is required for Pi-only maintenance.');
  }
  const outside = paths.filter(file => !file.startsWith('pstack/'));
  if (outside.length) block('scope-blocked', `Broader scope blocker: upstream changes outside pstack/:\n${displayPaths(outside)}\nNo staging checks were run. Review and obtain broader scope authorization before continuing.`);
  const review = reviewFiles(changes, stage, gitRaw);
  if (review.length) block('review-required', `Review changed validation/executable code before running staging checks:\n${displayPaths(review)}\nNo upstream code was run. Review first, then run checks manually in the retained staging pstack directory.`);
  const stagedComponent = join(stage, 'pstack');
  const blockers = [];
  if (!check('npm', ['run', 'check'], stagedComponent, 'Component checks')) blockers.push('component checks');
  if (!check('npm', ['test'], stagedComponent, 'Regression tests')) blockers.push('regression tests');
  if (!check('git', ['diff', '--check', initialHead], stage, 'Diff whitespace checks')) blockers.push('diff whitespace checks');
  let activationBlocked = false;
  if (!existsSync(adoption)) {
    console.error(`Activation blocker: installed adoption checker missing at ${adoption}`);
    evidence.prerequisites.push('Installed adoption checker is missing; restore the reviewed helper before activation.');
    blockers.push('activation: adoption checker missing');
    activationBlocked = true;
  } else if (!check(process.execPath, [adoption, 'check', '--cwd', source], source, 'Original component adoption check')) {
    blockers.push('activation: adoption check failed');
    activationBlocked = true;
  }
  if (blockers.length) block(activationBlocked ? 'activation-blocked' : 'validation-failed', `Staging blocked: ${blockers.join('; ')}.`);
  evidence.status = 'prepared';
}

try { main(); }
catch (error) {
  if (!evidence.prerequisites.includes(error.message)) evidence.prerequisites.push(error.message);
  console.error(error.message);
  process.exitCode = 1;
}
finally {
  // Never publish successful evidence until the original identity and clean state are rechecked.
  if (initialHead) {
    const rechecks = [
      () => {
        if (git(['rev-parse', 'HEAD']) !== initialHead) throw new Error('Source HEAD changed during staging. Do not integrate this result until reviewed.');
      },
      () => {
        if (gitPath(['rev-parse', '--symbolic-full-name', 'HEAD']) !== initialBranch) throw new Error('Source branch changed during staging. Do not integrate this result until reviewed.');
      },
      assertClean,
    ];
    for (const recheck of rechecks) {
      try { recheck(); }
      catch (error) {
        const message = `Concurrent source change blocker: ${error.message}`;
        evidence.status = 'activation-blocked';
        evidence.stale = true;
        evidence.prerequisites.push(message);
        console.error(message);
        process.exitCode = 1;
      }
    }
  }
  if (stage) {
    console.log(`Retained staging worktree: ${stage}
Inspect: git -C ${quote(stage)} status
Review: git -C ${quote(stage)} diff ${quote(initialHead)} --no-renames
After conflict resolution and scope/code review: cd ${quote(join(stage, 'pstack'))} && npm run check && npm test && git diff --check ${quote(initialHead)}
Original component adoption gate: ${quote(process.execPath)} ${quote(adoption)} check --cwd ${quote(source)}
Before Pi-only activation: review staged dependencies, selection/invocation changes and affected Pi behavior. Retain structural manifest checks; Cursor and Claude compatibility remain unverified, not activation prerequisites. Recheck source branch ${quote(initialBranch)}, HEAD ${quote(initialHead)}, cleanliness and pending Git operations. Edits invalidate prior checks.
Nothing was committed, applied to the source checkout, installed, trusted, lock-reset, or pushed.`);
  }
  finishEvidence(evidence);
}
