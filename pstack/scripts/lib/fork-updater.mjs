// Shared fork preparation primitives. Distributed as reviewed, byte-identical vendored copies.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function hookSafeEnv(env = process.env) {
  const rawCount = env.GIT_CONFIG_COUNT ?? '0';
  const count = Number(rawCount);
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawCount) || !Number.isSafeInteger(count) || count >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid GIT_CONFIG_COUNT; repair the subprocess environment.');
  return { ...env, GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${count}`]: '/dev/null' };
}
export function createRunner(defaultCwd) {
  function run(command, args, cwd = defaultCwd(), exactOutput = false) {
    const remote = command === 'git' && (args[0] === 'fetch' || args[0] === 'remote');
    const result = spawnSync(command, command === 'git' ? ['-c', 'core.hooksPath=/dev/null', ...args] : args,
      { cwd, env: hookSafeEnv(), encoding: command === 'git' ? null : 'utf8' });
    // Remote diagnostics may contain credential-bearing URLs. Never expose them, even on failure.
    if (remote) { result.stdout = ''; result.stderr = ''; result.output = [null, '', '']; }
    else if (command === 'git') {
      // Decode original bytes, never an already-lossy string. Keep BOMs and literal U+FFFD.
      const pathOrRef = exactOutput || args.includes('-z') || ['rev-parse', 'symbolic-ref'].includes(args[0]);
      if (result.stdout) {
        try { result.stdout = pathOrRef ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout) : result.stdout.toString('utf8'); }
        catch { throw new Error('Invalid UTF-8 in Git pathname/ref output; inspect the retained state before running checks.'); }
      }
      result.stderr = result.stderr?.toString('utf8') ?? '';
      result.output = [null, result.stdout, result.stderr];
    }
    return { ...result, ok: !result.error && result.status === 0 };
  }
  function gitRaw(args, cwd, exactOutput = args[0] !== 'cat-file') {
    const result = run('git', args, cwd, exactOutput);
    const remote = args[0] === 'fetch' || args[0] === 'remote';
    if (!result.ok) throw new Error(`git ${remote ? args[0] : args.join(' ')} failed: ${result.error?.code || `exit ${result.status}`}${result.stderr ? `\n${result.stderr}` : ''}`);
    return result.stdout;
  }
  // Only scalar Git metadata may be trimmed. Path/content APIs below always use raw output.
  const git = (args, cwd) => gitRaw(args, cwd).trim();
  // rev-parse single-path output has one trailing newline, not arbitrary whitespace.
  const gitPath = (args, cwd) => gitRaw(args, cwd, true).replace(/\n$/, '');
  return { run, git, gitRaw, gitPath };
}
export function nulPaths(output) {
  if (!output) return [];
  if (!output.endsWith('\0')) throw new Error('Expected NUL-terminated Git paths.');
  return output.slice(0, -1).split('\0');
}
export function changedFiles(gitRaw, head, cwd) {
  const fields = nulPaths(gitRaw(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', head, '--'], cwd));
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])$/.exec(fields[i]);
    if (!match || fields[i + 1] === undefined) throw new Error('Unexpected raw Git change record.');
    changes.push({ path: fields[i + 1], oldMode: match[1], newMode: match[2], oldOid: match[3], status: match[5] });
  }
  return changes;
}
export function reviewFiles(changes, stage, gitRaw) {
  const files = [];
  for (const change of changes) {
    const { path: file, oldMode, newMode, oldOid } = change;
    const target = join(stage, file);
    let stat;
    try { stat = lstatSync(target); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    if ([oldMode, newMode].some(mode => mode === '100755' || mode === '120000') ||
        stat?.isSymbolicLink() || (stat && (stat.mode & 0o111))) { files.push(file); continue; }
    const name = basename(file);
    const before = () => gitRaw(['cat-file', 'blob', oldOid], stage);
    if (name === 'package.json') {
      if (oldMode === '000000' || !stat?.isFile()) { files.push(`${file} (package added/removed)`); continue; }
      try {
        const oldPackage = JSON.parse(before()), newPackage = JSON.parse(readFileSync(target, 'utf8'));
        delete oldPackage.version; delete newPackage.version;
        if (JSON.stringify(oldPackage) !== JSON.stringify(newPackage)) files.push(`${file} (changes beyond version)`);
      } catch { files.push(`${file} (invalid package metadata)`); }
      continue;
    }
    const script = /(?:^|\/)scripts\//.test(file) || /\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|fish|ps1|rb|pl|cmd|bat|exe|wasm|so|dll)$/i.test(file);
    const npmConfig = ['.npmrc', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc', '.yarnrc.yml'].includes(name);
    const shebang = !script && !npmConfig && ((stat?.isFile() && readFileSync(target).subarray(0, 2).toString() === '#!') ||
      (oldMode === '100644' && before().startsWith('#!')));
    if (script || npmConfig || shebang) files.push(file);
  }
  return files;
}
export const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export const displayPaths = paths => paths.map(path => JSON.stringify(path)).join('\n');
export function runCheck(run, evidence, command, args, cwd, label) {
  const result = run(command, args, cwd);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  evidence.checks.push({ label, command, args, cwd, status: result.ok ? 'passed' : 'failed' });
  if (!result.ok) console.error(`${label}: BLOCKED (${result.error?.code || `exit ${result.status}`}).`);
  return result.ok;
}
export function finishEvidence(evidence) {
  // Call only after final source identity and cleanliness checks.
  console.log(`Preparation evidence: ${JSON.stringify(evidence)}`);
  console.log(`Preparation summary: ${evidence.status}; ${evidence.stage ? 'stage retained, not integrated' : 'no stage'}; ${evidence.checks.length} checks run; ${evidence.notRun?.length ?? 0} not run; ${evidence.prerequisites?.length ?? 0} outstanding prerequisites${evidence.stale ? '; stale evidence' : ''}.`);
}
