import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const implementation = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'update-upstream.mjs'), 'utf8');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pstack-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote');
  const source = join(root, 'source');
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
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function put(cwd, file, contents) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  }
  git(remote, 'init', '-b', 'trunk');
  put(remote, 'pstack/scripts/update-upstream.mjs', implementation);
  put(remote, 'pstack/package.json', JSON.stringify({ scripts: { check: 'node scripts/check.mjs', test: 'node scripts/check.mjs test' } }));
  put(remote, 'pstack/scripts/check.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
appendFileSync(process.env.HOME + '/checks', 'component ' + process.cwd() + ' ' + (process.argv[2] || 'check') + '\\n');
if (process.env.MUTATE_HEAD) execFileSync('git', ['commit', '--allow-empty', '-m', 'concurrent'], { cwd: process.env.MUTATE_HEAD });
if (process.env.MUTATE_SOURCE) writeFileSync(process.env.MUTATE_SOURCE + '/concurrent', 'changed');
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
    const result = spawnSync(process.execPath, [join(component, 'scripts/update-upstream.mjs')], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    return { ...result, output: result.stdout + result.stderr };
  }
  const stages = () => readdirSync(root).filter(name => name.startsWith('source-upstream-')).map(name => join(root, name));
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

test('already-current component creates no stage or checks', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Already up to date/);
  assert.deepEqual(f.stages(), []);
  assert.equal(f.checks(), '');
  f.unchanged();
});

for (const cwd of ['repository', 'nested', 'unrelated']) {
  test(`rejects ${cwd} cwd before Git operations`, t => {
    const f = fixture(t);
    f.advance();
    const refs = f.git(f.source, 'for-each-ref');
    const directory = cwd === 'repository' ? f.source : cwd === 'nested' ? join(f.component, 'scripts') : f.remote;
    const result = f.run({}, directory);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /canonical pstack component directory owning this updater/);
    assert.equal(f.git(f.source, 'for-each-ref'), refs);
    assert.deepEqual(f.stages(), []);
    f.unchanged();
  });
}

test('owning component cannot itself be the Git repository root', t => {
  const f = fixture(t);
  f.git(f.component, 'init', '-b', 'component-only');
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /directly inside the discovered Git repository root/);
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
    assert.equal(f.git(f.source, 'rev-parse', 'upstream/trunk'), before);
    assert.deepEqual(f.stages(), []);
  });
}

for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
  test(`rejects ongoing ${state}`, t => {
    const f = fixture(t);
    const file = f.git(f.source, 'rev-parse', '--path-format=absolute', '--git-path', state);
    if (state === 'MERGE_HEAD') writeFileSync(file, f.git(f.source, 'rev-parse', 'HEAD') + '\n');
    else mkdirSync(file);
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /ongoing merge\/rebase/);
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
  assert.match(result.output, /remote set-head upstream --auto failed/);
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
  assert.match(result.output, /no Claude strict validator applies/);
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

for (const kind of ['HEAD', 'SOURCE']) {
  test(`rechecks concurrent source ${kind} without reverting it`, t => {
    const f = fixture(t);
    f.advance();
    const before = f.baseline();
    const result = f.run({ [`MUTATE_${kind}`]: f.source });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Concurrent source change blocker/);
    if (kind === 'HEAD') assert.notEqual(f.baseline().head, before.head);
    else assert.equal(readFileSync(join(f.source, 'concurrent'), 'utf8'), 'changed');
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
