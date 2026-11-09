// Runs the version action as the runner does (INPUT_* in, $GITHUB_OUTPUT out) against throwaway repos.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ACTION = fileURLToPath(new URL('../../.github/actions/version/version.mjs', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'version-test-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function newRepo(name) {
  const dir = join(WORK, name);
  git(WORK, 'init', '-q', '--bare', `${name}.git`);
  git(WORK, 'clone', '-q', `${name}.git`, name);
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.com');
  return dir;
}

const commit = (dir, ...messages) =>
  git(dir, 'commit', '-q', '--allow-empty', ...messages.flatMap((message) => ['-m', message]));

function tag(dir, name) {
  commit(dir, `release ${name}`);
  git(dir, 'tag', name);
  git(dir, 'push', '-q', 'origin', `refs/tags/${name}`);
}

function run(dir, inputs) {
  const output = join(WORK, 'output');
  writeFileSync(output, '');
  const env = { ...process.env, GITHUB_OUTPUT: output };
  for (const [name, value] of Object.entries(inputs)) env[`INPUT_${name.toUpperCase()}`] = value;
  const result = spawnSync(process.execPath, [ACTION], { cwd: dir, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  const text = readFileSync(output, 'utf8');
  return {
    version: text.match(/^version=(.*)$/m)[1],
    files: text.match(/^files=(.*)$/m)[1],
  };
}

function pkg(dir, sub, version) {
  mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, sub, 'package.json'), JSON.stringify({ name: sub, version }));
}

const props = (dir, version) =>
  writeFileSync(
    join(dir, 'Directory.Build.props'),
    `<Project><PropertyGroup><Version>${version}</Version></PropertyGroup></Project>`,
  );
const propsVersion = (dir) =>
  readFileSync(join(dir, 'Directory.Build.props'), 'utf8').match(/<Version>([^<]+)/)[1];

describe('npm', () => {
  const inputs = { type: 'npm', paths: 'backend frontend' };

  test('an untagged version is released unchanged', () => {
    const dir = newRepo('npm-first');
    pkg(dir, 'backend', '1.0.0');
    pkg(dir, 'frontend', '1.0.0');
    assert.deepEqual(run(dir, inputs), { version: '1.0.0', files: '' });
  });

  test('every directory is bumped and reported', () => {
    const dir = newRepo('npm-bump');
    pkg(dir, 'backend', '1.0.0');
    pkg(dir, 'frontend', '1.0.0');
    tag(dir, 'v1.0.0');
    assert.deepEqual(run(dir, inputs), {
      version: '1.0.1',
      files: 'backend/package.json frontend/package.json',
    });
    assert.equal(JSON.parse(readFileSync(join(dir, 'frontend/package.json'))).version, '1.0.1');
  });

  test('a root package and its lockfile are bumped, keeping their formatting', () => {
    const dir = newRepo('npm-root');
    writeFileSync(join(dir, 'package.json'), '{\n    "name": "root",\n    "version": "2.3.4"\n}\n');
    writeFileSync(
      join(dir, 'package-lock.json'),
      `${JSON.stringify(
        { name: 'root', version: '2.3.4', lockfileVersion: 3, packages: { '': { name: 'root', version: '2.3.4' } } },
        null,
        2,
      )}\n`,
    );
    tag(dir, 'v2.3.4');
    assert.deepEqual(run(dir, { type: 'npm' }), { version: '2.3.5', files: 'package.json package-lock.json' });
    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{\n    "name": "root",\n    "version": "2.3.5"\n}\n');
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, '2.3.5');
    assert.equal(lock.packages[''].version, '2.3.5');
  });

  test('differing versions fail', () => {
    const dir = newRepo('npm-mismatch');
    pkg(dir, 'backend', '1.0.0');
    pkg(dir, 'frontend', '1.0.1');
    assert.throws(() => run(dir, inputs), /Versions differ/);
  });
});

describe('msbuild', () => {
  const inputs = { type: 'msbuild', paths: 'Directory.Build.props' };

  test('an untagged version is released unchanged and touches no files', () => {
    const dir = newRepo('msbuild-first');
    props(dir, '1.0.0');
    assert.deepEqual(run(dir, inputs), { version: '1.0.0', files: '' });
  });

  test('a tagged version is bumped and rewritten', () => {
    const dir = newRepo('msbuild-bump');
    props(dir, '1.0.0');
    tag(dir, 'v1.0.0');
    assert.deepEqual(run(dir, inputs), { version: '1.0.1', files: 'Directory.Build.props' });
    assert.equal(propsVersion(dir), '1.0.1');
  });

  test('minor resets patch, major resets minor and patch', () => {
    const dir = newRepo('msbuild-minor-major');
    props(dir, '1.4.7');
    tag(dir, 'v1.4.7');
    assert.equal(run(dir, { ...inputs, bump: 'minor' }).version, '1.5.0');
    props(dir, '1.4.7');
    assert.equal(run(dir, { ...inputs, bump: 'major' }).version, '2.0.0');
  });

  test('revision bumps the fourth part, patch resets it', () => {
    const dir = newRepo('msbuild-four');
    props(dir, '1.0.0.0');
    tag(dir, 'v1.0.0.0');
    assert.equal(run(dir, { ...inputs, bump: 'revision' }).version, '1.0.0.1');
    props(dir, '1.0.0.0');
    assert.equal(run(dir, { ...inputs, bump: 'patch' }).version, '1.0.1.0');
  });

  test('revision needs four parts', () => {
    const dir = newRepo('msbuild-revision-three');
    props(dir, '1.0.0');
    tag(dir, 'v1.0.0');
    assert.throws(() => run(dir, { ...inputs, bump: 'revision' }), /needs a four-part version/);
  });

  test('a missing version fails', () => {
    const dir = newRepo('msbuild-missing');
    writeFileSync(join(dir, 'Directory.Build.props'), '<Project/>');
    assert.throws(() => run(dir, inputs), /No version found/);
  });
});

describe('tags', () => {
  const inputs = { type: 'tags' };

  test('no tag releases 1.0.0 without files', () => {
    const dir = newRepo('tags-none');
    assert.deepEqual(run(dir, inputs), { version: '1.0.0', files: '' });
  });

  test('bumps the highest version and ignores the major tag', () => {
    const dir = newRepo('tags-latest');
    for (const name of ['v1.0.0', 'v1.0.3', 'v1.0.10', 'v1']) tag(dir, name);
    assert.equal(run(dir, inputs).version, '1.0.11');
  });

  test('only tags with the prefix count', () => {
    const dir = newRepo('tags-prefix');
    tag(dir, 'v3.0.0');
    assert.equal(run(dir, { ...inputs, tag_prefix: 'fixture-v' }).version, '1.0.0');
  });

  test('an unknown type or bump fails', () => {
    const dir = newRepo('tags-unknown');
    tag(dir, 'v1.0.0');
    assert.throws(() => run(dir, { type: 'yaml' }), /Unknown type 'yaml'/);
    assert.throws(() => run(dir, { ...inputs, bump: 'huge' }), /Unknown bump 'huge'/);
  });
});

describe('auto', () => {
  const inputs = { type: 'tags', bump: 'auto' };

  test('only breaking commits after the latest release count', () => {
    const dir = newRepo('auto-patch');
    commit(dir, 'feat!: breaking, but already released');
    tag(dir, 'v1.0.0');
    commit(dir, 'fix: something');
    assert.equal(run(dir, inputs).version, '1.0.1');
    commit(dir, 'docs: explain how feat!: marks a breaking change');
    assert.equal(run(dir, inputs).version, '1.0.1', 'a marker inside a subject is not breaking');
    commit(dir, 'feat(setup-node)!: drop an input');
    assert.equal(run(dir, inputs).version, '2.0.0');
  });

  test('a BREAKING CHANGE footer is a major', () => {
    const dir = newRepo('auto-footer');
    tag(dir, 'v1.0.3');
    commit(dir, 'refactor: rename inputs', 'BREAKING CHANGE: inputs are snake_case');
    assert.equal(run(dir, inputs).version, '2.0.0');
  });

  test('a breaking commit inside a merged PR is a major', () => {
    const dir = newRepo('auto-merge');
    tag(dir, 'v1.0.0');
    const main = git(dir, 'branch', '--show-current');
    git(dir, 'switch', '-q', '-c', 'feature');
    commit(dir, 'ci!: require a new input');
    git(dir, 'switch', '-q', main);
    commit(dir, 'fix: unrelated');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from psychodracon/feature', 'feature');
    assert.equal(run(dir, inputs).version, '2.0.0');
  });

  test('a shallow checkout fetches the history it needs', () => {
    const origin = newRepo('auto-shallow-origin');
    tag(origin, 'v1.0.0');
    commit(origin, 'feat!: breaking');
    commit(origin, 'fix: on top');
    git(origin, 'push', '-q', 'origin', 'HEAD');
    const branch = git(origin, 'branch', '--show-current');
    const url = `file://${join(WORK, 'auto-shallow-origin.git')}`;
    git(WORK, 'clone', '-q', '--depth', '1', '--branch', branch, url, 'auto-shallow');
    assert.equal(run(join(WORK, 'auto-shallow'), inputs).version, '2.0.0');
  });

  test('works for file versions too', () => {
    const dir = newRepo('auto-msbuild');
    props(dir, '1.4.7');
    tag(dir, 'v1.4.7');
    commit(dir, 'feat!: breaking');
    assert.equal(run(dir, { type: 'msbuild', paths: 'Directory.Build.props', bump: 'auto' }).version, '2.0.0');
  });
});
