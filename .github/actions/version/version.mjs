// The version action; inputs and outputs are described in action.yaml.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const VERSION_RE = /^\d+(\.\d+){2,3}$/;
// A conventional "type!:" or "type(scope)!:" subject, or a "BREAKING CHANGE:" footer.
const BREAKING_RE = /^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:/m;
const PARTS = { major: 0, minor: 1, patch: 2, revision: 3 };

class InputError extends Error {}

const input = (name, fallback) => process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const compare = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? -1) - (y[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
};

function releasedVersions(prefix) {
  return git('ls-remote', '--tags', '--refs', 'origin', `refs/tags/${prefix}*`)
    .split('\n')
    .map((line) => line.split('refs/tags/')[1] ?? '')
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length))
    .filter((version) => VERSION_RE.test(version))
    .sort(compare);
}

function autoBump(prefix) {
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    git('fetch', '--quiet', '--unshallow', '--tags', 'origin');
  }
  let latest = '';
  try {
    latest = git('describe', '--tags', '--abbrev=0', '--match', `${prefix}[0-9]*.[0-9]*.[0-9]*`);
  } catch {
    // No release yet: every commit counts.
  }
  const messages = git('log', '--format=%B', latest ? `${latest}..HEAD` : 'HEAD');
  return BREAKING_RE.test(messages) ? 'major' : 'patch';
}

function bump(version, kind, prefix) {
  const resolved = kind === 'auto' ? autoBump(prefix) : kind;
  const index = PARTS[resolved];
  if (index === undefined) throw new InputError(`Unknown bump '${kind}'`);
  const parts = version.split('.').map(Number);
  if (resolved === 'revision' && parts.length !== 4) {
    throw new InputError(`Bump 'revision' needs a four-part version, got ${version}`);
  }
  parts[index] += 1;
  parts.fill(0, index + 1);
  return parts.join('.');
}

// Keeps the file's indentation and line endings, as npm does.
function updateJson(file, update) {
  const text = readFileSync(file, 'utf8');
  const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? 2;
  const data = JSON.parse(text);
  update(data);
  const json = `${JSON.stringify(data, null, indent)}\n`;
  writeFileSync(file, text.includes('\r\n') ? json.replace(/\n/g, '\r\n') : json);
}

// Paths are joined with "/" so the reported files work with git on every OS.
const npmDir = (path) => (path.replace(/\/+$/, '') === '.' ? '' : `${path.replace(/\/+$/, '')}/`);

const FORMATS = {
  npm: {
    read: (path) => JSON.parse(readFileSync(`${npmDir(path)}package.json`, 'utf8')).version ?? '',
    files: (path) =>
      [`${npmDir(path)}package.json`, `${npmDir(path)}package-lock.json`].filter((file) => existsSync(file)),
    write(path, current, next) {
      const [pkg, lock] = this.files(path);
      updateJson(pkg, (data) => {
        data.version = next;
      });
      if (lock) {
        updateJson(lock, (data) => {
          data.version = next;
          if (data.packages?.['']) data.packages[''].version = next;
        });
      }
    },
  },
  msbuild: {
    read: (path) => readFileSync(path, 'utf8').match(/<Version>(\d+(?:\.\d+){2,3})<\/Version>/)?.[1] ?? '',
    files: (path) => [path],
    write(path, current, next) {
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text.replace(`<Version>${current}</Version>`, `<Version>${next}</Version>`));
    },
  },
};

function release({ type, paths, bump: kind, prefix }) {
  if (type === 'tags') {
    const current = releasedVersions(prefix).at(-1);
    return { version: current ? bump(current, kind, prefix) : '1.0.0', files: [] };
  }

  const format = FORMATS[type];
  if (!format) throw new InputError(`Unknown type '${type}'`);

  let current = '';
  for (const path of paths) {
    const found = format.read(path);
    if (!VERSION_RE.test(found)) throw new InputError(`No version found in ${path}`);
    if (current && found !== current) {
      throw new InputError(`Versions differ: ${path} has ${found}, expected ${current}`);
    }
    current = found;
  }

  if (!releasedVersions(prefix).includes(current)) return { version: current, files: [] };

  const next = bump(current, kind, prefix);
  for (const path of paths) format.write(path, current, next);
  return { version: next, files: paths.flatMap((path) => format.files(path)) };
}

try {
  const { version, files } = release({
    type: input('type', ''),
    paths: input('paths', '.').split(/\s+/),
    bump: input('bump', 'patch'),
    prefix: input('tag_prefix', 'v'),
  });
  const output = `version=${version}\nfiles=${files.join(' ')}\n`;
  console.log(output.trim());
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
} catch (error) {
  console.log(`::error::${error instanceof InputError ? error.message : error.stack}`);
  process.exitCode = 1;
}
