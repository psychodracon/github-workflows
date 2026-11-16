// Runs the git-release action as the runner does (INPUT_* in, $GITHUB_OUTPUT out) against throwaway repos,
// some of whose branch moves while the release runs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ACTION = fileURLToPath(new URL('../../.github/actions/git-release/release.mjs', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'git-release-test-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

const CI = `on:
  pull_request:
    paths-ignore: ["**.md"]
  push:
    branches: [main]
    paths-ignore:
      - .github/**   # workflow changes
      - "**.md"
`;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function commitFile(dir, file, content, message) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message);
  git(dir, 'push', '-q', 'origin', 'main');
}

// A repository and a depth-1 checkout as the runner has; `moved` is pushed to main before the release.
function release(name, { moved, inputs = { version: '1.0.1', files: 'package.json' } } = {}) {
  const origin = join(WORK, `${name}.git`);
  git(WORK, 'init', '-q', '--bare', '-b', 'main', origin);
  const pusher = join(WORK, `${name}-pusher`);
  git(WORK, 'clone', '-q', origin, pusher);
  writeFileSync(join(pusher, 'package.json'), '{"version":"1.0.0"}\n');
  commitFile(pusher, '.github/workflows/ci.yaml', CI, 'chore: initial commit');
  git(pusher, 'tag', 'v1');
  git(pusher, 'push', '-q', 'origin', 'v1');
  const runner = join(WORK, `${name}-runner`);
  git(WORK, 'clone', '-q', '--depth', '1', `file://${origin}`, runner);
  if (moved) commitFile(pusher, ...moved);

  writeFileSync(join(runner, 'package.json'), '{"version":"1.0.1"}\n');
  const output = join(WORK, `${name}-output`);
  writeFileSync(output, '');
  const env = {
    ...process.env,
    GITHUB_REF_NAME: 'main',
    GITHUB_OUTPUT: output,
    GITHUB_WORKFLOW_REF: 'me/app/.github/workflows/ci.yaml@refs/heads/main',
  };
  for (const [key, value] of Object.entries(inputs)) env[`INPUT_${key.toUpperCase()}`] = value;
  const result = spawnSync(process.execPath, [ACTION], { cwd: runner, env, encoding: 'utf8' });

  const tagged = (tag) => spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`], { cwd: origin, encoding: 'utf8' }).stdout.trim();
  return {
    status: result.status,
    output: readFileSync(output, 'utf8'),
    details: result.stdout + result.stderr,
    log: git(origin, 'log', '--format=%s', 'main').split('\n'),
    head: git(origin, 'rev-parse', 'main'),
    tagged,
  };
}

test('commits, tags and pushes the release', () => {
  const r = release('clean');
  assert.equal(r.status, 0, r.details);
  assert.equal(r.output, 'released=true\n');
  assert.deepEqual(r.log, ['chore(release): v1.0.1', 'chore: initial commit']);
  assert.equal(r.tagged('v1.0.1'), r.head);
});

test('tags HEAD without files and moves the major tag', () => {
  const r = release('tag-only', { inputs: { version: '1.0.1', major_tag: 'true' } });
  assert.equal(r.status, 0, r.details);
  assert.deepEqual(r.log, ['chore: initial commit']);
  assert.equal(r.tagged('v1.0.1'), r.head);
  assert.equal(r.tagged('v1'), r.head);
});

test('rebases onto commits that start no run', () => {
  const r = release('ignored', { moved: ['docs/guide.md', 'docs\n', 'docs: guide'] });
  assert.equal(r.status, 0, r.details);
  assert.equal(r.output, 'released=true\n');
  assert.deepEqual(r.log, ['chore(release): v1.0.1', 'docs: guide', 'chore: initial commit']);
  assert.equal(r.tagged('v1.0.1'), r.head);
});

test('steps aside for commits that start a run', () => {
  const r = release('superseded', { moved: ['src/index.js', 'fix\n', 'fix: something'] });
  assert.equal(r.status, 0, r.details);
  assert.equal(r.output, 'released=false\n');
  assert.match(r.details, /Superseded/);
  assert.deepEqual(r.log, ['fix: something', 'chore: initial commit']);
  assert.equal(r.tagged('v1.0.1'), '');
});

test('fails for commits that skip CI', () => {
  const r = release('skipped', { moved: ['src/index.js', 'fix\n', 'fix: something [skip ci]'] });
  assert.equal(r.status, 1, r.details);
  assert.match(r.details, /skip ci/);
  assert.equal(r.output, '');
});
