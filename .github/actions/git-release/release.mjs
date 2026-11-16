// The git-release action; inputs and outputs are described in action.yaml.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const SKIP_CI_RE = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks: ?true/im;

const input = (name, fallback) => process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const indent = (line) => line.search(/\S/);
const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

// The block or flow list under on: -> push: -> paths-ignore: of a workflow file.
function pathsIgnore(workflow) {
  const lines = workflow
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .filter((line) => line.trim());
  let line = '';
  let start = 0;
  let end = lines.length;
  for (const key of ['on', 'push', 'paths-ignore']) {
    const found = lines.slice(start, end).findIndex((l) => unquote(l.trim().split(':')[0]) === key);
    if (found === -1) return [];
    line = lines[start + found];
    start += found + 1;
    const after = lines.slice(start).findIndex((l) => indent(l) <= indent(line));
    end = after === -1 ? lines.length : start + after;
  }
  const inline = line.slice(line.indexOf(':') + 1).trim();
  const items = inline
    ? inline.replace(/^\[|\]$/g, '').split(',')
    : lines.slice(start, end).map((l) => l.trim().replace(/^- /, ''));
  return items.map(unquote).filter(Boolean);
}

// GitHub filter patterns: * and ? stay within a directory, ** crosses them.
function matches(file, pattern) {
  const wildcards = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' };
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*|\?/g, (wildcard) => wildcards[wildcard]);
  return new RegExp(`^${source}$`).test(file);
}

// GITHUB_WORKFLOW_REF is owner/repo/.github/workflows/ci.yaml@refs/heads/main, also in a called workflow.
function startsRun(base, remote) {
  const workflow = process.env.GITHUB_WORKFLOW_REF.split('@')[0].split('/').slice(2).join('/');
  const ignored = pathsIgnore(readFileSync(workflow, 'utf8'));
  const changed = git('diff', '--name-only', base, remote).split('\n').filter(Boolean);
  return changed.some((file) => !ignored.some((pattern) => matches(file, pattern)));
}

// Tags HEAD and returns the refs to push atomically.
function tagHead({ tag, version, files, majorTag, branch }) {
  const refs = files.length ? [`HEAD:refs/heads/${branch}`] : [];
  git('tag', '-fa', tag, '-m', tag);
  refs.push(`refs/tags/${tag}`);
  if (majorTag) {
    const major = `v${version.split('.')[0]}`;
    git('tag', '-f', major);
    refs.push(`+refs/tags/${major}`);
  }
  return refs;
}

function release(options) {
  const { tag, files, branch } = options;
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  let base = git('rev-parse', 'HEAD');
  if (files.length) {
    git('add', '--', ...files);
    git('commit', '--quiet', '-m', `chore(release): ${tag}`);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const refs = tagHead(options);
    if (spawnSync('git', ['push', '--atomic', 'origin', ...refs], { stdio: 'inherit' }).status === 0) return true;
    if (!files.length) throw new Error(`Pushing ${tag} failed`);

    git('fetch', '--quiet', '--no-tags', 'origin', branch);
    const remote = git('rev-parse', 'FETCH_HEAD');
    if (remote === base) throw new Error(`Pushing ${tag} failed`);

    // Commits that start no run cannot release this one: put the release on top of them.
    if (!startsRun(base, remote)) {
      git('rebase', '--quiet', remote);
      base = remote;
      continue;
    }
    if (SKIP_CI_RE.test(git('log', '--format=%B', `${base}..${remote}`))) {
      throw new Error(`${branch} moved with [skip ci] changes; release ${tag} by hand`);
    }
    // Commits with a run of their own: that run releases them together with this one.
    console.log(`::notice::Superseded by ${remote.slice(0, 7)}, whose run releases ${tag}`);
    return false;
  }
  throw new Error(`${branch} kept moving; ${tag} was not released`);
}

try {
  const version = input('version', '');
  const released = release({
    tag: `v${version}`,
    version,
    files: input('files', '').split(/\s+/).filter(Boolean),
    majorTag: input('major_tag', 'false') === 'true',
    branch: process.env.GITHUB_REF_NAME,
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `released=${released}\n`);
} catch (error) {
  console.log(`::error::${error.message}`);
  process.exitCode = 1;
}
