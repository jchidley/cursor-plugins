import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, createRunner, quote } from './lib/fork-updater.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const implementation = readFileSync(join(scripts, 'update-upstream.mjs'), 'utf8');
const shared = readFileSync(join(scripts, 'lib/fork-updater.mjs'), 'utf8');
const sharedDigest = readFileSync(join(scripts, 'lib/fork-updater.sha256'), 'utf8');
function fixture(t, sourceName = 'source') {
  const root = mkdtempSync(join(tmpdir(), 'pstack-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote');
  const source = join(root, sourceName);
  const component = join(source, 'pstack');
  const home = join(root, 'home');
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const allowed = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']);
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !allowed.has(key)) delete env[key];
  // Do not inherit npm options or test injections from the invoking session.
  for (const key of Object.keys(env)) if (/^npm_/i.test(key) || /^(FAIL_|MUTATE_)/.test(key)) delete env[key];
  mkdirSync(remote);
  mkdirSync(home);
  function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function put(cwd, file, contents) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  }
  git(remote, 'init', '-b', 'trunk');
  put(remote, 'pstack/scripts/update-upstream.mjs', implementation);
  put(remote, 'pstack/scripts/lib/fork-updater.mjs', shared);
  put(remote, 'pstack/scripts/lib/fork-updater.sha256', sharedDigest);
  put(remote, 'pstack/package.json', JSON.stringify({ scripts: { check: 'node scripts/check.mjs', test: 'node scripts/check.mjs test' } }));
  put(remote, 'pstack/scripts/check.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
appendFileSync(process.env.HOME + '/checks', 'component ' + process.cwd() + ' ' + (process.argv[2] || 'check') + '\\n');
if (process.env.MUTATE_HEAD) execFileSync('git', ['commit', '--allow-empty', '-m', 'concurrent'], { cwd: process.env.MUTATE_HEAD });
if (process.env.MUTATE_SOURCE) writeFileSync(process.env.MUTATE_SOURCE + '/concurrent', 'changed');
if (process.env.MUTATE_BRANCH) execFileSync('git', ['checkout', '-B', 'concurrent-branch'], { cwd: process.env.MUTATE_BRANCH });
if (process.env.FAIL_CHECK || (process.env.FAIL_TEST && process.argv[2] === 'test')) process.exit(1);
`);
  put(remote, 'pstack/shared.txt', 'base\n');
  put(remote, 'pstack/.cursor-plugin/plugin.json', '{}\n');
  put(remote, 'other-plugin/shared.txt', 'other base\n');
  put(remote, 'package.json', JSON.stringify({ scripts: { check: 'exit 99', test: 'exit 99' } }));
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'base');
  git(root, 'clone', remote, source);
  git(source, 'remote', 'rename', 'origin', 'upstream');
  put(home, '.pi/agent/lib/skill-adoption.mjs', `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.HOME + '/checks', 'adoption ' + JSON.stringify(process.argv.slice(2)) + ' cwd=' + process.cwd() + '\\n');
if (process.env.FAIL_ADOPTION) process.exit(1);
`);
  put(home, '.pi/agent/settings.json', '{"unchanged":true}\n');
  put(home, '.pi/agent/skill-adoption.json', '{"lock":"unchanged"}\n');
  const baseline = () => ({ head: git(source, 'rev-parse', 'HEAD'), branch: git(source, 'symbolic-ref', 'HEAD') });
  const original = baseline();
  function advance(file = 'pstack/upstream.txt', contents = 'upstream\n') {
    put(remote, file, contents);
    git(remote, 'add', '.');
    git(remote, 'commit', '-m', 'upstream change');
  }
  function run(extra = {}, cwd = component) {
    const result = spawnSync(process.execPath, [join(component, 'scripts/update-upstream.mjs')], { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120_000 });
    return { ...result, output: result.stdout + result.stderr };
  }
  const stages = () => readdirSync(root).filter(name => name.startsWith(basename(source) + '-upstream-')).map(name => join(root, name));
  const checks = () => existsSync(join(home, 'checks')) ? readFileSync(join(home, 'checks'), 'utf8') : '';
  function unchanged(expected = original) {
    assert.deepEqual(baseline(), expected);
    assert.equal(git(source, 'status', '--porcelain'), '');
    assert.equal(readFileSync(join(home, '.pi/agent/settings.json'), 'utf8'), '{"unchanged":true}\n');
    assert.equal(readFileSync(join(home, '.pi/agent/skill-adoption.json'), 'utf8'), '{"lock":"unchanged"}\n');
    assert.equal(existsSync(join(component, 'upstream.txt')), false);
    assert.equal(readFileSync(join(source, 'other-plugin/shared.txt'), 'utf8'), 'other base\n');
  }
  return { root, remote, source, component, home, git, put, advance, run, stages, checks, baseline, unchanged };
}

test('invalid UTF-8 extensionless nonexecuting shebang path blocks before checks and retains stage', t => {
  const f = fixture(t);
  const file = Buffer.concat([Buffer.from(f.remote + '/pstack/helper-'), Buffer.from([0xff])]);
  writeFileSync(file, '#!/bin/sh\nexit 99\n', { mode: 0o644 });
  f.git(f.remote, 'add', '-A');
  f.git(f.remote, 'commit', '-m', 'invalid pathname fixture');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Invalid UTF-8 in Git pathname\/ref output/);
  const evidence = evidenceOf(result);
  assert.equal(evidence.status, 'activation-blocked');
  assert.equal(evidence.stale, undefined);
  assert.equal(evidence.stage, f.stages()[0]);
  assert.equal(f.stages().length, 1);
  const retained = Buffer.concat([Buffer.from(f.stages()[0] + '/pstack/helper-'), Buffer.from([0xff])]);
  assert.equal(readFileSync(retained, 'utf8'), '#!/bin/sh\nexit 99\n');
  assert.ok(existsSync(f.git(f.stages()[0], 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD')));
  assert.equal(f.checks(), '');
  assert.equal(evidence.checks.some(check => ['npm', 'node'].includes(check.command)), false);
  assert.equal(evidence.notRun.length, 4);
  f.unchanged();
});

for (const file of ['pstack/helper-\uFFFD', 'pstack/\uFEFFhelper-雪 space\t\n  ']) {
  test('valid Unicode extensionless shebang remains a review blocker: ' + JSON.stringify(file), t => {
    const f = fixture(t);
    f.advance(file, '#!/bin/sh\nexit 99\n');
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    const evidence = evidenceOf(result);
    assert.equal(evidence.status, 'review-required');
    assert.ok(result.output.includes(JSON.stringify(file)), result.output);
    assert.equal(f.stages().length, 1);
    assert.equal(f.checks(), '');
    f.unchanged();
  });
}

test('already-current component creates no stage or checks', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Already up to date/);
  assert.deepEqual(f.stages(), []);
  assert.equal(f.checks(), '');
  f.unchanged();
});

function recordUpdaterGit(f) {
  const bin = join(f.home, 'git-bin');
  const log = join(f.home, 'git-calls');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  assert.equal(realGit.status, 0, realGit.stderr);
  f.put(bin, 'git', `#!/bin/sh
printf '%s\\n' "$*" >> ${quote(log)}
exec ${quote(realGit.stdout.trim())} "$@"
`);
  chmodSync(join(bin, 'git'), 0o755);
  return { PATH: bin + ':' + process.env.PATH, calls: () => existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

for (const cwd of ['repository', 'nested', 'unrelated']) {
  test(`rejects ${cwd} cwd before Git operations`, t => {
    const f = fixture(t);
    f.advance();
    const refs = f.git(f.source, 'for-each-ref');
    const directory = cwd === 'repository' ? f.source : cwd === 'nested' ? join(f.component, 'scripts') : f.remote;
    const recorded = recordUpdaterGit(f);
    const result = f.run({ PATH: recorded.PATH }, directory);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /canonical pstack component directory owning this updater/);
    const evidence = evidenceOf(result);
    assert.equal(evidence.status, 'scope-blocked');
    assert.equal(evidence.stage, null);
    assert.deepEqual(evidence.checks, []);
    assert.equal(evidence.notRun.length, 4);
    assert.equal(recorded.calls(), '', 'wrong cwd must not invoke Git, including network commands');
    assert.equal(f.checks(), '');
    assert.equal(f.git(f.source, 'for-each-ref'), refs);
    assert.deepEqual(f.stages(), []);
    f.unchanged();
  });
}

test('owning component cannot itself be the Git repository root', t => {
  const f = fixture(t);
  f.git(f.component, 'init', '-b', 'component-only');
  const before = [f.source, f.component].map(root => ({
    refs: f.git(root, 'for-each-ref'), status: f.git(root, 'status', '--porcelain'),
  }));
  const recorded = recordUpdaterGit(f);
  const result = f.run({ PATH: recorded.PATH });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /directly inside the discovered Git repository root/);
  const evidence = evidenceOf(result);
  assert.equal(evidence.status, 'scope-blocked');
  assert.equal(evidence.stage, null);
  assert.deepEqual(evidence.checks, []);
  assert.equal(evidence.notRun.length, 4);
  assert.equal(recorded.calls(), '-c core.hooksPath=/dev/null rev-parse --show-toplevel\n',
    'wrong component may only discover the repository, not mutate Git or contact remotes');
  assert.deepEqual([f.source, f.component].map(root => ({
    refs: f.git(root, 'for-each-ref'), status: f.git(root, 'status', '--porcelain'),
  })), before);
  assert.equal(f.checks(), '');
  assert.deepEqual(f.stages(), []);
});

for (const dirty of ['tracked', 'untracked', 'staged']) {
  test(`rejects ${dirty} changes in other plugins before fetch`, t => {
    const f = fixture(t);
    f.advance();
    const before = f.git(f.source, 'rev-parse', 'upstream/trunk');
    f.put(f.source, dirty === 'untracked' ? 'other-plugin/new.txt' : 'other-plugin/shared.txt', 'dirty\n');
    if (dirty === 'staged') f.git(f.source, 'add', '.');
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Entire source repository must be clean/);
    assert.doesNotMatch(result.output, /Concurrent source change blocker/);
    assert.equal(f.git(f.source, 'rev-parse', 'upstream/trunk'), before);
    assert.deepEqual(f.stages(), []);
  });
}

for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) {
  test(`rejects ongoing ${state}`, t => {
    const f = fixture(t);
    const file = f.git(f.source, 'rev-parse', '--path-format=absolute', '--git-path', state);
    if (state.endsWith('_HEAD')) writeFileSync(file, f.git(f.source, 'rev-parse', 'HEAD') + '\n');
    else mkdirSync(file);
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /ongoing merge\/rebase/);
    assert.doesNotMatch(result.output, /Concurrent source change blocker/);
    assert.deepEqual(f.stages(), []);
  });
}

test('missing upstream blocks without staging', t => {
  const f = fixture(t);
  f.git(f.source, 'remote', 'remove', 'upstream');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /remote get-url upstream failed/);
  assert.deepEqual(f.stages(), []);
  f.unchanged();
});

for (const cached of ['missing', 'stale']) {
  test(`discovers live non-main default with ${cached} upstream HEAD`, t => {
    const f = fixture(t);
    f.git(f.remote, 'checkout', '-b', 'actual-default');
    if (cached === 'missing') f.git(f.source, 'symbolic-ref', '--delete', 'refs/remotes/upstream/HEAD');
    f.advance();
    const result = f.run();
    assert.equal(result.status, 0, result.output);
    assert.equal(f.git(f.source, 'symbolic-ref', 'refs/remotes/upstream/HEAD'), 'refs/remotes/upstream/actual-default');
    assert.equal(f.stages().length, 1);
    f.unchanged();
  });
}

test('unadvertised remote HEAD blocks without default-branch guessing', t => {
  const f = fixture(t);
  f.advance();
  f.git(f.remote, 'symbolic-ref', 'HEAD', 'refs/heads/missing-default');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /git remote failed/);
  assert.deepEqual(f.stages(), []);
  f.unchanged();
});

test('retains uncommitted repository-root merge and checks only staging component and original adoption', t => {
  const f = fixture(t);
  f.advance();
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  const [stage] = f.stages();
  assert.ok(stage);
  assert.equal(f.git(stage, 'rev-parse', '--show-toplevel'), stage);
  assert.equal(f.git(stage, 'rev-parse', 'HEAD'), f.git(f.source, 'rev-parse', 'HEAD'));
  assert.ok(existsSync(f.git(stage, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD')));
  assert.equal(readFileSync(join(stage, 'pstack/upstream.txt'), 'utf8'), 'upstream\n');
  assert.ok(f.checks().includes(`component ${stage}/pstack check\n`));
  assert.ok(f.checks().includes(`component ${stage}/pstack test\n`));
  assert.ok(f.checks().includes(`adoption ${JSON.stringify(['check', '--cwd', f.component])} cwd=${f.component}`));
  assert.equal(f.checks().split('\n').filter(Boolean).length, 3);
  assert.match(result.output, /Nothing was committed, applied/);
  f.unchanged();
});

test('conflicts retain stage and preserve local customization commit', t => {
  const f = fixture(t);
  f.advance('pstack/shared.txt', 'upstream version\n');
  f.put(f.source, 'pstack/shared.txt', 'custom version\n');
  f.git(f.source, 'add', '.');
  f.git(f.source, 'commit', '-m', 'customization');
  const expected = f.baseline();
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Merge conflicts retained/);
  assert.match(result.output, /Inspect: git -C/);
  const [stage] = f.stages();
  assert.equal(f.git(stage, 'diff', '--name-only', '--diff-filter=U'), 'pstack/shared.txt');
  assert.equal(f.checks(), '');
  f.unchanged(expected);
});

for (const file of ['other-plugin/shared.txt', 'root-update.md']) {
  test(`outside scope ${file} blocks before any checks`, t => {
    const f = fixture(t);
    f.advance(file, 'outside change\n');
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Broader scope blocker/);
    assert.ok(result.output.includes(file));
    assert.equal(f.stages().length, 1);
    assert.equal(f.checks(), '');
    f.unchanged();
  });
}

for (const [flag, expected] of [['FAIL_CHECK', /component checks/], ['FAIL_TEST', /regression tests/], ['FAIL_ADOPTION', /activation: adoption check failed/]]) {
  test(`${flag} retains stage without live or settings changes`, t => {
    const f = fixture(t);
    f.advance();
    const result = f.run({ [flag]: '1' });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, expected);
    assert.equal(f.stages().length, 1);
    f.unchanged();
  });
}

test('missing installed adoption checker blocks activation', t => {
  const f = fixture(t);
  f.advance();
  rmSync(join(f.home, '.pi/agent/lib/skill-adoption.mjs'));
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Activation blocker: installed adoption checker missing/);
  assert.equal(f.stages().length, 1);
  f.unchanged();
});

for (const [file, contents, mode] of [
  ['pstack/scripts/check.mjs', 'throw new Error("must not execute");\n'],
  ['pstack/skills/new/scripts/task', 'extensionless script\n'],
  ['pstack/.npmrc', 'script-shell=/bin/false\n'],
  ['pstack/skills/new/.npmrc', 'script-shell=/bin/false\n'],
  ['pstack/package.json', '{"scripts":{"check":"touch should-not-exist"}}'],
  ['pstack/skills/new/package.json', '{"scripts":{"postinstall":"exit 1"}}'],
  ['pstack/package-lock.json', '{}\n'],
  ['pstack/tool', '#!/bin/sh\nexit 1\n'],
  ['pstack/binary', 'not a script\n', 0o755],
  ['pstack/package.json', JSON.stringify({ version: '1.2.3', scripts: { check: 'node scripts/check.mjs', test: 'node scripts/check.mjs test' } }), 0o755],
  ['pstack/new.py', 'raise Exception("not reviewed")\n'],
]) {
  test(`changed executable/configuration ${file} requires review`, t => {
    const f = fixture(t);
    f.advance(file, contents);
    if (mode) {
      chmodSync(join(f.remote, file), mode);
      f.git(f.remote, 'add', '.');
      f.git(f.remote, 'commit', '-m', 'executable mode');
    }
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Review changed validation\/executable code/);
    assert.match(result.output, /No upstream code was run/);
    assert.equal(f.checks(), '');
    assert.equal(f.stages().length, 1);
    f.unchanged();
  });
}

test('changed symlink requires review before checks', t => {
  const f = fixture(t);
  symlinkSync('shared.txt', join(f.remote, 'pstack/link'));
  f.git(f.remote, 'add', '.');
  f.git(f.remote, 'commit', '-m', 'symlink');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Review changed validation\/executable code/);
  assert.equal(f.checks(), '');
  f.unchanged();
});

test('package metadata symlink cannot bypass the code review gate', t => {
  const f = fixture(t);
  const contents = readFileSync(join(f.remote, 'pstack/package.json'), 'utf8');
  rmSync(join(f.remote, 'pstack/package.json'));
  f.put(f.remote, 'pstack/metadata.json', contents);
  symlinkSync('metadata.json', join(f.remote, 'pstack/package.json'));
  f.git(f.remote, 'add', '.');
  f.git(f.remote, 'commit', '-m', 'package symlink');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Review changed validation\/executable code/);
  assert.equal(f.checks(), '');
  f.unchanged();
});

test('removed extensionless executable requires review', t => {
  const f = fixture(t);
  f.put(f.source, 'pstack/tool', 'executable\n');
  chmodSync(join(f.source, 'pstack/tool'), 0o755);
  f.git(f.source, 'add', '.');
  f.git(f.source, 'commit', '-m', 'local tool');
  f.git(f.remote, 'fetch', f.source, 'HEAD');
  f.git(f.remote, 'merge', '--ff-only', 'FETCH_HEAD');
  f.git(f.remote, 'rm', 'pstack/tool');
  f.git(f.remote, 'commit', '-m', 'remove tool');
  const expected = f.baseline();
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Review changed validation\/executable code/);
  assert.equal(f.checks(), '');
  f.unchanged(expected);
});

test('package version-only changes may pass and Cursor manifest reports its actual limitation', t => {
  const f = fixture(t);
  const pkg = JSON.parse(readFileSync(join(f.remote, 'pstack/package.json'), 'utf8'));
  pkg.version = '1.2.3';
  f.advance('pstack/package.json', JSON.stringify(pkg));
  f.advance('pstack/.cursor-plugin/plugin.json', '{"version":"1.2.3"}\n');
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /not Cursor runtime\/plugin validation/);
  assert.match(result.output, /no Cursor or Claude runtime validation is required for Pi-only maintenance/);
  f.unchanged();
});

test('whitespace errors block success and retain stage', t => {
  const f = fixture(t);
  f.advance('pstack/upstream.txt', 'trailing space \n');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /diff whitespace checks/);
  assert.equal(f.stages().length, 1);
  f.unchanged();
});

for (const kind of ['HEAD', 'SOURCE', 'BRANCH']) {
  test(`rechecks concurrent source ${kind} without reverting it`, t => {
    const f = fixture(t);
    f.advance();
    const before = f.baseline();
    const result = f.run({ [`MUTATE_${kind}`]: f.source });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Concurrent source change blocker/);
    if (kind === 'HEAD') assert.notEqual(f.baseline().head, before.head);
    else if (kind === 'SOURCE') assert.equal(readFileSync(join(f.source, 'concurrent'), 'utf8'), 'changed');
    else {
      assert.equal(f.baseline().head, before.head);
      assert.notEqual(f.baseline().branch, before.branch);
    }
    assert.equal(evidenceOf(result).status, 'activation-blocked');
    assert.equal(evidenceOf(result).stale, true);
    assert.match(result.output, /stale evidence/);
    assert.doesNotMatch(result.output, /Preparation summary: prepared|Staging checks passed/);
    assert.equal(f.stages().length, 1);
  });
}

test('disables Git worktree and merge hooks', t => {
  const f = fixture(t);
  f.advance();
  const hooks = f.git(f.source, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks');
  for (const name of ['post-checkout', 'post-merge']) {
    writeFileSync(join(hooks, name), `#!/bin/sh\nprintf triggered >> "${f.home}/hook-triggered"\n`);
    chmodSync(join(hooks, name), 0o755);
  }
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(existsSync(join(f.home, 'hook-triggered')), false);
  f.unchanged();
});

test('repeated preparation creates unique sibling repository worktrees', t => {
  const f = fixture(t);
  f.advance();
  for (let i = 0; i < 2; i++) {
    const result = f.run();
    assert.equal(result.status, 0, result.output);
  }
  const stages = f.stages();
  assert.equal(stages.length, 2);
  assert.notEqual(f.git(stages[0], 'symbolic-ref', 'HEAD'), f.git(stages[1], 'symbolic-ref', 'HEAD'));
  f.unchanged();
});

function evidenceOf(result) {
  const lines = result.stdout.split('\n').filter(line => line.startsWith('Preparation evidence: '));
  assert.equal(lines.length, 1, result.output);
  const evidence = JSON.parse(lines[0].slice('Preparation evidence: '.length));
  assert.match(result.stdout, new RegExp('Preparation summary: ' + evidence.status + ';'));
  return evidence;
}

test('vendored shared primitives match their pinned SHA-256 digest', () => {
  assert.match(sharedDigest, /^[a-f0-9]{64}\n$/);
  assert.equal(createHash('sha256').update(shared).digest('hex'), sharedDigest.trim());
});

for (const [name, expected, setup, extra] of [
  ['current', 'already-current', () => {}, {}],
  ['prepared', 'prepared', f => f.advance(), {}],
  ['conflict', 'conflict', f => {
    f.advance('pstack/shared.txt', 'upstream\n');
    f.put(f.source, 'pstack/shared.txt', 'local\n');
    f.git(f.source, 'add', '.');
    f.git(f.source, 'commit', '-m', 'local');
  }, {}],
  ['scope', 'scope-blocked', f => f.advance('other-plugin/new.txt'), {}],
  ['review', 'review-required', f => f.advance('pstack/new.PY'), {}],
  ['validation', 'validation-failed', f => f.advance(), { FAIL_CHECK: '1' }],
  ['adoption', 'activation-blocked', f => f.advance(), { FAIL_ADOPTION: '1' }],
  ['missing adoption', 'activation-blocked', f => {
    f.advance();
    rmSync(join(f.home, '.pi/agent/lib/skill-adoption.mjs'));
  }, {}],
]) {
  test(`structured evidence records ${name} without claiming integration`, t => {
    const f = fixture(t);
    setup(f);
    const expectedSource = f.baseline();
    const result = f.run(extra);
    const evidence = evidenceOf(result);
    assert.equal(evidence.status, expected);
    assert.deepEqual(evidence.source, { component: f.component, repository: f.source, ...expectedSource });
    assert.equal(evidence.target.ref, 'refs/remotes/upstream/trunk');
    assert.equal(evidence.target.head, f.git(f.remote, 'rev-parse', 'HEAD'));
    assert.equal(result.status, ['already-current', 'prepared'].includes(expected) ? 0 : 1);
    assert.equal(evidence.stage, f.stages()[0] ?? null);
    if (evidence.stage) {
      assert.equal('refs/heads/' + evidence.stageBranch, f.git(evidence.stage, 'symbolic-ref', 'HEAD'));
      assert.match(result.stdout, /stage retained, not integrated/);
    }
    const checksRun = ['prepared', 'validation', 'adoption', 'missing adoption'].includes(name);
    assert.equal(evidence.checks.length, checksRun ? (name === 'missing adoption' ? 3 : 4) : 0);
    assert.equal(evidence.notRun.length, checksRun ? (name === 'missing adoption' ? 1 : 0) : 4);
    assert.deepEqual(evidence.checks.filter(check => check.status === 'failed').map(check => check.label),
      name === 'validation' ? ['Component checks', 'Regression tests'] : name === 'adoption' ? ['Original component adoption check'] : []);
    if (!['prepared', 'current'].includes(name)) assert.ok(evidence.prerequisites.length);
    f.unchanged(expectedSource);
  });
}

test('Cursor manifest changes retain structural checks without a non-Pi activation prerequisite', t => {
  const f = fixture(t);
  f.advance('pstack/.cursor-plugin/plugin.json', '{"version":"2"}\n');
  const result = f.run();
  const evidence = evidenceOf(result);
  assert.equal(result.status, 0, result.output);
  assert.equal(evidence.status, 'prepared');
  assert.deepEqual(evidence.prerequisites, []);
  assert.match(result.output, /Cursor compatibility is unverified/);
  assert.equal(evidence.checks.length, 4);
  assert.ok(evidence.checks.every(check => !/Cursor|qualification/i.test(check.label)));
  f.unchanged();
});

const unusualNames = ['café', 'with space', 'with\ttab', 'with\nnewline', 'with"quote', "with'quote", 'trailing '];
for (const name of unusualNames) {
  for (const script of [false, true]) {
    test(`exact unusual path ${JSON.stringify(name)} ${script ? 'requires review' : 'stays in scope'}`, t => {
      const f = fixture(t);
      const file = `pstack/${name}${script ? '.PY' : ''}`;
      f.advance(file);
      const result = f.run();
      assert.equal(result.status, script ? 1 : 0, result.output);
      assert.equal(evidenceOf(result).status, script ? 'review-required' : 'prepared');
      if (script) {
        assert.ok(result.output.includes(JSON.stringify(file)));
        assert.equal(f.checks(), '');
      }
      const [stage] = f.stages();
      const { gitRaw } = createRunner(() => stage);
      assert.deepEqual(changedFiles(gitRaw, f.baseline().head, stage).map(change => change.path), [file]);
      f.unchanged();
    });
  }
}

test('outside path with control and whitespace is safely displayed and scope-blocked', t => {
  const f = fixture(t);
  const file = 'other-plugin/café\t"note\ntrailing ';
  f.advance(file);
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.equal(evidenceOf(result).status, 'scope-blocked');
  assert.ok(result.output.includes(JSON.stringify(file)));
  assert.equal(f.checks(), '');
  f.unchanged();
});

test('conflict paths preserve Unicode, quotes, controls and trailing whitespace', t => {
  const f = fixture(t);
  const file = 'pstack/café\t"conflict\ntrailing ';
  f.put(f.source, file, 'base\n');
  f.git(f.source, 'add', '.');
  f.git(f.source, 'commit', '-m', 'base conflict file');
  f.git(f.remote, 'fetch', f.source, 'HEAD');
  f.git(f.remote, 'merge', '--ff-only', 'FETCH_HEAD');
  f.advance(file, 'upstream\n');
  f.put(f.source, file, 'local\n');
  f.git(f.source, 'add', '.');
  f.git(f.source, 'commit', '-m', 'local conflict');
  const expected = f.baseline();
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.equal(evidenceOf(result).status, 'conflict');
  assert.ok(result.output.includes(JSON.stringify(file)));
  assert.equal(f.checks(), '');
  f.unchanged(expected);
});

for (const destination of ['missing-target', '../../outside-missing-target']) {
  test(`dangling symlink to ${destination} requires review`, t => {
    const f = fixture(t);
    symlinkSync(destination, join(f.remote, 'pstack/dangling'));
    f.git(f.remote, 'add', '.');
    f.git(f.remote, 'commit', '-m', 'dangling symlink');
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.equal(evidenceOf(result).status, 'review-required');
    assert.equal(f.checks(), '');
    f.unchanged();
  });
}

for (const mode of ['100755', '100644']) {
  test(`mode-only transition to ${mode} requires review with both modes retained`, t => {
    const f = fixture(t);
    if (mode === '100644') {
      chmodSync(join(f.source, 'pstack/shared.txt'), 0o755);
      f.git(f.source, 'add', '.');
      f.git(f.source, 'commit', '-m', 'executable base');
      f.git(f.remote, 'fetch', f.source, 'HEAD');
      f.git(f.remote, 'merge', '--ff-only', 'FETCH_HEAD');
    }
    chmodSync(join(f.remote, 'pstack/shared.txt'), mode === '100755' ? 0o755 : 0o644);
    f.git(f.remote, 'add', '.');
    f.git(f.remote, 'commit', '-m', 'mode-only change');
    const expected = f.baseline();
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.equal(evidenceOf(result).status, 'review-required');
    const [stage] = f.stages();
    const { gitRaw } = createRunner(() => stage);
    const [change] = changedFiles(gitRaw, expected.head, stage);
    assert.equal(change.path, 'pstack/shared.txt');
    assert.equal(change.oldMode, mode === '100755' ? '100644' : '100755');
    assert.equal(change.newMode, mode);
    assert.equal(change.status, 'M');
    assert.equal(f.checks(), '');
    f.unchanged(expected);
  });
}

for (const file of ['pstack/scripts/check.mjs', 'pstack/package.json', 'pstack/plain-shebang']) {
  test(`deleted ${file} requires review before running checks`, t => {
    const f = fixture(t);
    if (file.endsWith('plain-shebang')) {
      f.put(f.source, file, '#!/bin/sh\nexit 0\n');
      f.git(f.source, 'add', '.');
      f.git(f.source, 'commit', '-m', 'nonexecutable shebang');
      f.git(f.remote, 'fetch', f.source, 'HEAD');
      f.git(f.remote, 'merge', '--ff-only', 'FETCH_HEAD');
    }
    f.git(f.remote, 'rm', file);
    f.git(f.remote, 'commit', '-m', 'delete');
    const expected = f.baseline();
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.equal(evidenceOf(result).status, 'review-required');
    assert.equal(f.checks(), '');
    f.unchanged(expected);
  });
}

for (const file of ['pstack/scripts/check.mjs', 'pstack/old.PY']) {
  test(`rename-out of ${file} to ordinary text reviews the deleted source`, t => {
    const f = fixture(t);
    if (file.endsWith('.PY')) {
      f.put(f.source, file, 'plain content\n');
      f.git(f.source, 'add', '.');
      f.git(f.source, 'commit', '-m', 'old script');
      f.git(f.remote, 'fetch', f.source, 'HEAD');
      f.git(f.remote, 'merge', '--ff-only', 'FETCH_HEAD');
    }
    f.git(f.remote, 'mv', file, 'pstack/notes.txt');
    f.git(f.remote, 'commit', '-m', 'rename');
    const expected = f.baseline();
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.equal(evidenceOf(result).status, 'review-required');
    assert.ok(result.output.includes(JSON.stringify(file)));
    const [stage] = f.stages();
    const { gitRaw } = createRunner(() => stage);
    const changes = changedFiles(gitRaw, expected.head, stage);
    assert.ok(changes.some(change => change.path === file && change.status === 'D'));
    assert.ok(changes.some(change => change.path === 'pstack/notes.txt' && change.status === 'A'));
    assert.equal(f.checks(), '');
    f.unchanged(expected);
  });
}

test('remote failures cannot disclose synthetic credentials from URLs or Git stderr', t => {
  const f = fixture(t);
  const secret = 'SYNTHETIC_CREDENTIAL_DO_NOT_PRINT';
  const fakeUrl = `https://user:${secret}@example.invalid/repo?token=${secret}`;
  f.git(f.source, 'remote', 'set-url', 'upstream', fakeUrl);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  // Fail fetch locally, without network, and simulate credential-bearing Git diagnostics.
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  f.put(bin, 'git', `#!/bin/sh
if [ "$3" = fetch ]; then
  printf '%s\\n' ${quote('fatal: ' + fakeUrl)} >&2
  exit 1
fi
exec ${quote(realGit)} "$@"
`);
  chmodSync(join(bin, 'git'), 0o755);
  const result = f.run({ PATH: bin + ':' + process.env.PATH });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /git fetch failed/);
  assert.match(result.output, /Fetching configured upstream remote: upstream/);
  assert.ok(!result.output.includes(secret));
  assert.ok(!result.output.includes(fakeUrl));
  assert.equal(evidenceOf(result).status, 'activation-blocked');
  assert.deepEqual(f.stages(), []);
  assert.equal(f.checks(), '');
  f.unchanged();
});

test('retained recovery instructions include original adoption and affected runtime gates', t => {
  const f = fixture(t);
  f.advance('pstack/new.py');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(quote(join(f.home, '.pi/agent/lib/skill-adoption.mjs')) + ' check --cwd ' + quote(f.component)));
  assert.match(result.output, /scope\/code review/);
  assert.match(result.output, /npm run check && npm test && git diff --check/);
  assert.match(result.output, /Cursor and Claude compatibility remain unverified, not activation prerequisites/);
  assert.match(result.output, /Recheck source branch.*HEAD.*cleanliness and pending Git operations/);
  assert.match(result.output, /Edits invalidate prior checks/);
  f.unchanged();
});

test('repository paths with trailing controls and whitespace are not trimmed', t => {
  const f = fixture(t, 'source \t\n ');
  f.advance();
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  const evidence = evidenceOf(result);
  assert.equal(evidence.status, 'prepared');
  assert.equal(evidence.source.repository, f.source);
  assert.equal(evidence.stage, f.stages()[0]);
  f.unchanged();
});

for (const file of ['other-plugin/new.txt', 'pstack/new.py']) {
  test(`Cursor compatibility limitation survives the earlier gate for ${file}`, t => {
    const f = fixture(t);
    f.advance('pstack/.cursor-plugin/plugin.json', '{"version":"2"}\n');
    f.advance(file);
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    const evidence = evidenceOf(result);
    assert.equal(evidence.status, file.startsWith('other-plugin/') ? 'scope-blocked' : 'review-required');
    assert.ok(evidence.prerequisites.every(item => !/Cursor|Claude/.test(item)));
    assert.match(result.output, /Cursor compatibility is unverified/);
    assert.equal(evidence.checks.length, 0);
    assert.equal(evidence.notRun.length, 4);
    assert.equal(f.checks(), '');
    f.unchanged();
  });
}

test('Unicode trailing whitespace branches remain distinct during source recheck', t => {
  const f = fixture(t);
  const original = 'concurrent-branch\u00a0';
  f.git(f.source, 'branch', '-m', original);
  f.advance();
  const result = f.run({ MUTATE_BRANCH: f.source });
  assert.equal(result.status, 1, result.output);
  const evidence = evidenceOf(result);
  assert.equal(evidence.source.branch, 'refs/heads/' + original);
  assert.equal(evidence.status, 'activation-blocked');
  assert.equal(evidence.stale, true);
  assert.match(result.output, /stale evidence/);
});

test('upstream default refs retain Unicode trailing whitespace', t => {
  const f = fixture(t);
  const name = 'actual-default\u00a0';
  f.git(f.remote, 'checkout', '-b', name);
  f.advance();
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(evidenceOf(result).target.ref, 'refs/remotes/upstream/' + name);
});
