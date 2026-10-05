import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const component = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routerAnchors = [
  'Routing is read-only.',
  'Do not start the recommended workflow, chain another router or change selection',
  'separate user entry',
  'no skill needed',
  'Do not grant trust, install resources or run candidate scripts.',
  'Distinguish present, enabled, unqualified and blocked.',
  'Missing qualification evidence means unqualified.',
  "Read the candidate's sibling",
  'trusted project/personal Pi package selections',
  'Never invent a tool or weaken a review or approval gate.',
];

export function checkCustomizations(root) {
  root = path.resolve(root);
  const errors = [];
  const error = (file, message) => errors.push(`${file}: ${message}`);
  let realRoot;
  try { realRoot = fs.realpathSync(root); }
  catch { return [`${root}: component directory does not exist.`]; }
  const read = file => {
    try { return fs.readFileSync(path.join(root, file), 'utf8'); }
    catch { error(file, 'cannot read file; restore it.'); return ''; }
  };
  const json = file => {
    try {
      const value = JSON.parse(read(file));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { error(file, 'must contain a JSON object.'); return {}; }
  };
  const inside = target => target.startsWith(`${realRoot}${path.sep}`);
  const checkPath = (file, target, fileOnly = true) => {
    if (typeof target !== 'string' || !target || path.isAbsolute(target) || /^[a-z]+:/i.test(target) || target.includes('\\')) {
      error(file, `invalid component-relative path ${target}.`); return;
    }
    const resolved = path.resolve(realRoot, target);
    if (!inside(resolved)) { error(file, `path escapes pstack: ${target}.`); return; }
    try {
      if (!inside(fs.realpathSync(resolved))) error(file, `symlink escapes pstack: ${target}.`);
      else {
        const stat = fs.statSync(resolved);
        if (!stat.isFile() && (fileOnly || !stat.isDirectory())) error(file, `path must be ${fileOnly ? 'a file' : 'a file or directory'}: ${target}.`);
      }
    } catch { error(file, `file does not exist: ${target}.`); }
  };
  let directories = [];
  try { directories = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }); }
  catch { error('skills', 'cannot list skill directories.'); }
  const skills = directories.filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => `skills/${entry.name}/SKILL.md`).sort();
  if (!skills.length) error('skills', 'must contain flat skill directories.');
  const names = new Map();
  for (const file of skills) {
    checkPath(file, file);
    const text = read(file);
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (frontmatter === undefined) error(file, 'missing YAML frontmatter.');
    const nameLines = (frontmatter ?? '').match(/^name\s*:.*$/gm) ?? [];
    const name = nameLines[0]?.replace(/^name\s*:\s*/, '').replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (nameLines.length !== 1 || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      error(file, 'declare exactly one valid, nonempty skill name.');
    } else if (names.has(name)) error(file, `duplicate name ${name}, also in ${names.get(name)}.`);
    else names.set(name, file);
    const flags = (frontmatter ?? '').match(/^disable-model-invocation\s*:.*$/gm) ?? [];
    if (flags.length !== 1 || !/^disable-model-invocation\s*:\s*true\s*(?:#.*)?$/.test(flags[0])) {
      error(file, 'declare exactly one disable-model-invocation: true.');
    }
  }
  const pkg = json('package.json');
  if (typeof pkg.name !== 'string' || !pkg.name) error('package.json', 'must declare a package name.');
  if (JSON.stringify(pkg.pi?.skills) !== JSON.stringify(['./skills'])) error('package.json', "pi.skills must be exactly ['./skills'].");
  for (const field of ['extensions', 'prompts', 'themes']) {
    if (!Array.isArray(pkg.pi?.[field]) || pkg.pi[field].length) error('package.json', `pi.${field} must be an empty array; export skills only.`);
  }
  for (const script of ['check', 'test', 'update:upstream']) {
    if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script]) error('package.json', `missing ${script} script.`);
  }
  // Cursor's manifest is not Matt's Claude schema; do not require a skill list or version alignment.
  const cursor = json('.cursor-plugin/plugin.json');
  for (const field of ['name', 'version']) {
    if (typeof cursor[field] !== 'string' || !cursor[field]) error('.cursor-plugin/plugin.json', `missing ${field}.`);
  }
  const router = read('skills/ask-pstack/SKILL.md');
  for (const anchor of routerAnchors) {
    if (!router.includes(anchor)) error('skills/ask-pstack/SKILL.md', `missing safeguard anchor "${anchor}".`);
  }
  const adoption = json('skill-adoption.json');
  if (adoption.schema !== 1 || adoption.id !== 'pstack') error('skill-adoption.json', 'expected schema 1 and id pstack.');
  for (const field of ['supportingFiles', 'dependencies']) {
    const map = adoption[field];
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      error('skill-adoption.json', `${field} must be an owner-to-paths object.`); continue;
    }
    for (const [owner, targets] of Object.entries(map)) {
      const label = `skill-adoption.json ${field}[${owner}]`;
      if (!skills.includes(owner)) error(label, 'owner is not a known skill entrypoint.');
      if (!Array.isArray(targets)) { error(label, 'must be an array.'); continue; }
      for (const target of targets) {
        checkPath(label, target, field === 'dependencies');
        if (field === 'dependencies' && !skills.includes(target)) error(label, `dependency is not a known skill entrypoint: ${target}.`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkCustomizations(component);
  if (errors.length) {
    console.error(errors.map(error => `FAIL: ${error}`).join('\n'));
    process.exitCode = 1;
  } else console.log('PASS: pstack fork customization structural checks.');
  console.log('Structural checks do not establish Cursor runtime compatibility, workflow behavior, or model qualification.');
}
