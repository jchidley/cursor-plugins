import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCustomizations } from './check-customizations.mjs';

const component = join(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'pstack-check-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'pstack');
  mkdirSync(root);
  for (const file of ['skills', 'package.json', 'skill-adoption.json', '.cursor-plugin']) {
    cpSync(join(component, file), join(root, file), { recursive: true });
  }
  const change = (file, transform) => writeFileSync(join(root, file), transform(readFileSync(join(root, file), 'utf8')));
  const json = (file, transform) => change(file, text => JSON.stringify(transform(JSON.parse(text))));
  return { root, temp, change, json };
}

test('current collection and copied fixture pass without Matt buckets or Claude manifests', t => {
  assert.deepEqual(checkCustomizations(component), []);
  const f = fixture(t);
  assert.deepEqual(checkCustomizations(f.root), []);
});

test('new flat upstream skills are included automatically', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'skills/new-upstream'));
  writeFileSync(join(f.root, 'skills/new-upstream/SKILL.md'), '---\nname: new-upstream\ndisable-model-invocation: true\n---\n');
  assert.deepEqual(checkCustomizations(f.root), []);
  f.change('skills/new-upstream/SKILL.md', text => text.replace('true', 'false'));
  assert.match(checkCustomizations(f.root).join('\n'), /new-upstream.*disable-model-invocation: true/);
});

for (const [name, transform, expected] of [
  ['missing name', text => text.replace('name: ask-pstack\n', ''), /exactly one valid/],
  ['empty name', text => text.replace('name: ask-pstack', 'name: ""'), /exactly one valid/],
  ['duplicate name field', text => text.replace('name: ask-pstack', 'name: ask-pstack\nname: again'), /exactly one valid/],
  ['duplicate command', text => text.replace('name: ask-pstack', 'name: how'), /duplicate name how/],
  ['missing invocation flag', text => text.replace('disable-model-invocation: true\n', ''), /exactly one disable/],
  ['duplicate invocation flag', text => text.replace('disable-model-invocation: true', 'disable-model-invocation: true\ndisable-model-invocation: true'), /exactly one disable/],
  ['false invocation flag', text => text.replace('disable-model-invocation: true', 'disable-model-invocation: false'), /exactly one disable/],
  ['quoted invocation flag', text => text.replace('disable-model-invocation: true', 'disable-model-invocation: "true"'), /exactly one disable/],
  ['missing frontmatter', text => text.replace(/^---\n[\s\S]*?\n---\n/, ''), /missing YAML/],
  ['lost router boundary', text => text.replace('Routing is read-only.', 'Routing may execute.'), /missing safeguard anchor/],
]) {
  test(`rejects ${name}`, t => {
    const f = fixture(t);
    f.change('skills/ask-pstack/SKILL.md', transform);
    assert.match(checkCustomizations(f.root).join('\n'), expected);
  });
}

for (const field of ['extensions', 'prompts', 'themes', 'skills']) {
  test(`rejects changed pi.${field} exports`, t => {
    const f = fixture(t);
    f.json('package.json', pkg => { pkg.pi[field] = ['./unexpected']; return pkg; });
    assert.match(checkCustomizations(f.root).join('\n'), new RegExp(`pi.${field}`));
  });
}

test('rejects invalid package JSON, missing scripts and invalid Cursor metadata', t => {
  const f = fixture(t);
  f.change('package.json', () => '{bad');
  f.json('.cursor-plugin/plugin.json', cursor => { delete cursor.version; return cursor; });
  assert.match(checkCustomizations(f.root).join('\n'), /package.json: must contain a JSON object/);
  assert.match(checkCustomizations(f.root).join('\n'), /missing check script/);
  assert.match(checkCustomizations(f.root).join('\n'), /plugin.json: missing version/);
});

test('accepts CRLF and comments but fails missing skill files', t => {
  const f = fixture(t);
  f.change('skills/ask-pstack/SKILL.md', text => text.replace('disable-model-invocation: true', 'disable-model-invocation: true # explicit').replaceAll('\n', '\r\n'));
  assert.deepEqual(checkCustomizations(f.root), []);
  rmSync(join(f.root, 'skills/how/SKILL.md'));
  assert.match(checkCustomizations(f.root).join('\n'), /how\/SKILL.md: cannot read/);
});

for (const field of ['supportingFiles', 'dependencies']) {
  for (const [label, target, expected] of [
    ['outside path', '../outside.md', /escapes pstack/],
    ['absolute path', '/tmp/outside.md', /invalid component-relative/],
    ['URL', 'https://example.invalid/file', /invalid component-relative/],
    ['Windows path', 'C:\\outside.md', /invalid component-relative/],
    ['missing file', 'skills/absent/SKILL.md', /does not exist/],
  ]) {
    test(`${field} rejects ${label}`, t => {
      const f = fixture(t);
      f.json('skill-adoption.json', value => { value[field]['skills/ask-pstack/SKILL.md'] = [target]; return value; });
      assert.match(checkCustomizations(f.root).join('\n'), expected);
    });
  }
  test(`${field} rejects unknown owner and invalid map/array`, t => {
    const f = fixture(t);
    f.json('skill-adoption.json', value => { value[field]['skills/unknown/SKILL.md'] = 'bad'; return value; });
    let errors = checkCustomizations(f.root).join('\n');
    assert.match(errors, /owner is not a known skill/);
    assert.match(errors, /must be an array/);
    f.json('skill-adoption.json', value => { value[field] = []; return value; });
    errors = checkCustomizations(f.root).join('\n');
    assert.match(errors, /owner-to-paths object/);
  });
}

test('supports reference directories but rejects symlink escape', t => {
  const f = fixture(t);
  writeFileSync(join(f.temp, 'outside.md'), 'outside');
  symlinkSync(join(f.temp, 'outside.md'), join(f.root, 'escaped.md'));
  f.json('skill-adoption.json', value => { value.supportingFiles['skills/ask-pstack/SKILL.md'] = ['escaped.md', 'skills']; return value; });
  const errors = checkCustomizations(f.root).join('\n');
  assert.match(errors, /symlink escapes pstack/);
  assert.ok(!errors.includes('path must be a file: skills'));
});

test('rejects unknown schema and dependencies that are not skill entrypoints', t => {
  const f = fixture(t);
  f.json('skill-adoption.json', value => { value.schema = 2; value.dependencies['skills/ask-pstack/SKILL.md'] = ['package.json']; return value; });
  const errors = checkCustomizations(f.root).join('\n');
  assert.match(errors, /expected schema 1/);
  assert.match(errors, /dependency is not a known skill entrypoint/);
});

test('missing component returns actionable errors', () => {
  assert.match(checkCustomizations('/nonexistent-pstack-fixture').join('\n'), /does not exist/);
});
