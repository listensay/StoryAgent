import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const versionFiles = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parts(version) {
  if (!stableVersion.test(version)) throw new Error(`Expected a stable version, received ${version}.`);
  const values = version.split('.').map(Number);
  if (values.some(value => !Number.isSafeInteger(value))) throw new Error('Version is too large.');
  return values;
}

function compare(left, right) {
  const a = parts(left), b = parts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function nextVersion(current, tags, increment = 'patch') {
  parts(current);
  const base = tags.filter(tag => tag.startsWith('v') && stableVersion.test(tag.slice(1)))
    .map(tag => tag.slice(1)).reduce((latest, version) => compare(version, latest) > 0 ? version : latest, current);
  if (!['patch', 'minor', 'major'].includes(increment)) {
    parts(increment);
    if (compare(increment, base) <= 0) throw new Error(`Release version must be greater than ${base}.`);
    return increment;
  }
  const values = parts(base), index = { major: 0, minor: 1, patch: 2 }[increment];
  values[index]++;
  for (let reset = index + 1; reset < 3; reset++) values[reset] = 0;
  const version = values.join('.');
  parts(version);
  return version;
}

export function updateVersions(sources, next) {
  parts(next);
  const pkg = JSON.parse(sources['package.json']), lock = JSON.parse(sources['package-lock.json']);
  const config = JSON.parse(sources['src-tauri/tauri.conf.json']);
  const cargoPackage = /(^\[package\]\r?\n[\s\S]*?)(?=^\[|$(?![\s\S]))/m;
  const cargoEntry = /^\[\[package\]\]\r?\nname = "storyagent"\r?\n[\s\S]*?(?=^\[\[package\]\]|$(?![\s\S]))/m;
  const cargoVersion = sources['src-tauri/Cargo.toml'].match(cargoPackage)?.[0].match(/^version = "([^"]+)"/m)?.[1];
  const cargoLockVersion = sources['src-tauri/Cargo.lock'].match(cargoEntry)?.[0].match(/^version = "([^"]+)"/m)?.[1];
  const versions = [pkg.version, lock.version, lock.packages?.['']?.version, config.version, cargoVersion, cargoLockVersion];
  if (versions.some(version => version !== pkg.version)) throw new Error('Synchronize all application versions before releasing.');
  parts(pkg.version);
  const files = {};
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    let remaining = file === 'package-lock.json' ? 2 : 1;
    files[file] = sources[file].replace(/("version"\s*:\s*")[^"]*(")/g, (match, prefix, suffix) => remaining-- > 0 ? `${prefix}${next}${suffix}` : match);
    const expected = JSON.parse(sources[file]);
    expected.version = next;
    if (file === 'package-lock.json') expected.packages[''].version = next;
    if (JSON.stringify(JSON.parse(files[file])) !== JSON.stringify(expected)) throw new Error(`Cannot safely locate the application version fields in ${file}.`);
  }
  files['src-tauri/Cargo.toml'] = sources['src-tauri/Cargo.toml'].replace(cargoPackage, section => section.replace(/^(version = ")[^"]*(")/m, (_, prefix, suffix) => `${prefix}${next}${suffix}`));
  files['src-tauri/Cargo.lock'] = sources['src-tauri/Cargo.lock'].replace(cargoEntry, section => section.replace(/^(version = ")[^"]*(")/m, (_, prefix, suffix) => `${prefix}${next}${suffix}`));
  return files;
}

function execute(command, args, { capture = false } = {}) {
  return new Promise((accept, reject) => {
    const npm = command === 'npm' && process.env.npm_execpath;
    const child = spawn(npm ? process.execPath : command, npm ? [process.env.npm_execpath, ...args] : args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: false });
    let output = '';
    if (capture) { child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume(); }
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(output.trimEnd()) : reject(new Error(`${command} ${args.join(' ')} failed (${code}).`)));
  });
}

export async function release({ args = [], run = execute, read = readFile, write = writeFile, pause = ms => new Promise(accept => setTimeout(accept, ms)), log = console.log } = {}) {
  const dryRun = args.includes('--dry-run'), requested = args.filter(arg => arg !== '--dry-run');
  if (requested.length > 1) throw new Error('Usage: npm run release -- [patch|minor|major|x.y.z] [--dry-run]');
  const sources = Object.fromEntries(await Promise.all(versionFiles.map(async file => [file, await read(file, 'utf8')])));
  const branch = await run('git', ['branch', '--show-current'], { capture: true });
  const dirty = await run('git', ['status', '--porcelain'], { capture: true });
  if (!dryRun && (branch !== 'main' || dirty)) throw new Error('Release requires main and a clean working tree. Commit only authorized task changes first.');
  let repository;
  if (!dryRun) {
    const remote = await run('git', ['remote', 'get-url', 'origin'], { capture: true });
    repository = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
    if (!repository) throw new Error('origin must point to a GitHub repository.');
    const endpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
    if (!JSON.parse(sources['src-tauri/tauri.conf.json']).plugins?.updater?.endpoints?.includes(endpoint)) throw new Error('The updater endpoint must match the origin repository.');
    await run('gh', ['auth', 'status', '--hostname', 'github.com'], { capture: true });
    const secrets = await run('gh', ['api', `repos/${repository}/actions/secrets`, '--paginate', '--jq', '.secrets[].name'], { capture: true });
    if (!secrets.split('\n').includes('TAURI_SIGNING_PRIVATE_KEY')) throw new Error('Configure the repository Actions Secret TAURI_SIGNING_PRIVATE_KEY.');
    await run('git', ['fetch', 'origin', 'main', '--tags']);
    await run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  }
  const tags = (await run('git', ['tag', '--list', 'v*'], { capture: true })).split('\n');
  const version = nextVersion(JSON.parse(sources['package.json']).version, tags, requested[0]);
  const files = updateVersions(sources, version), tag = `v${version}`;
  log(`${dryRun ? 'Plan' : 'Release'}: ${tag}; synchronize ${versionFiles.join(', ')}; test; commit; push main + tag; wait for GitHub Release.`);
  if (dryRun) { log('Dry run uses local tags. Publishing requires GitHub CLI authentication, the signing secret and a clean main branch.'); return { version, dryRun }; }
  for (const file of versionFiles) await write(file, files[file]);
  await run('npm', ['test']);
  await run('npm', ['run', 'ui:build']);
  await run('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']);
  await run('git', ['diff', '--check']);
  const changes = await run('git', ['status', '--porcelain'], { capture: true });
  if (changes.split('\n').filter(Boolean).some(line => !versionFiles.includes(line.slice(3)))) throw new Error('The working tree changed during validation. Review the changes before releasing.');
  for (const file of versionFiles) if (await read(file, 'utf8') !== files[file]) throw new Error(`${file} changed during validation. Review it before releasing.`);
  await run('git', ['add', '--', ...versionFiles]);
  await run('git', ['commit', '-m', `chore: release ${version}`]);
  const commit = await run('git', ['rev-parse', 'HEAD'], { capture: true });
  await run('git', ['tag', '-a', tag, '-m', `StoryAgent ${version}`]);
  await run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
  let workflow;
  for (let attempt = 0; attempt < 12; attempt++) {
    const runs = JSON.parse(await run('gh', ['run', 'list', '--repo', repository, '--workflow', 'release.yml', '--commit', commit, '--event', 'push', '--limit', '1', '--json', 'databaseId'], { capture: true }));
    if (runs[0]) { workflow = runs[0].databaseId; break; }
    await pause(10000);
  }
  if (!workflow) throw new Error(`${tag} was pushed, but its release workflow has not appeared. Check GitHub Actions before retrying.`);
  await run('gh', ['run', 'watch', String(workflow), '--repo', repository, '--exit-status', '--interval', '15']);
  const published = JSON.parse(await run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,url,assets'], { capture: true }));
  const prefix = `${JSON.parse(sources['src-tauri/tauri.conf.json']).productName}_${version}_`, bundles = ['darwin_aarch64.app.tar.gz', 'darwin_x64.app.tar.gz', 'linux_amd64.AppImage', 'windows_x64-setup.exe'].map(suffix => `${prefix}${suffix}`);
  const required = ['latest.json', ...bundles, ...bundles.map(name => `${name}.sig`)];
  const names = new Set(published.assets?.map(asset => asset.name));
  if (published.isDraft || required.some(name => !names.has(name))) throw new Error(`${tag} is not a complete published updater release. Check GitHub Actions.`);
  log(`Published ${tag}: ${published.url}`);
  return { version, url: published.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  release({ args: process.argv.slice(2) }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
