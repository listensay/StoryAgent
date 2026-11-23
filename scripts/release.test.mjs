import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { nextVersion, release, updateVersions, versionFiles } from './release.mjs';

const execute = promisify(execFile), directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const sources = {
  'CHANGELOG.md': '# 更新记录\n\n## 0.1.1 · 2026-11-23\n\n- 支持查看版本更新记录。\n',
  'package.json': '{\n  "name": "storyagent",\n  "version": "0.1.0"\n}\n',
  'package-lock.json': '{\n  "version": "0.1.0",\n  "packages": {\n    "": { "version": "0.1.0" },\n    "node_modules/other": { "version": "0.1.0" }\n  }\n}\n',
  'src-tauri/tauri.conf.json': '{\n  "productName": "storyagent",\n  "version": "0.1.0",\n  "plugins": { "updater": { "endpoints": ["https://github.com/listensay/StoryAgent/releases/latest/download/latest.json"] } }\n}\n',
  'src-tauri/Cargo.toml': '[package]\nname = "storyagent"\nversion = "0.1.0"\n\n[dependencies]\nother = { version = "0.1.0" }\n',
  'src-tauri/Cargo.lock': 'version = 4\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n\n[[package]]\nname = "storyagent"\nversion = "0.1.0"\ndependencies = ["other"]\n\n[[package]]\nname = "third"\nversion = "0.1.0"\n',
};

async function fixture({ fail, secrets = 'TAURI_SIGNING_PRIVATE_KEY', pendingRuns = 0, draft = false, omitAsset } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'storyagent-release-test-'));
  directories.push(directory);
  const repository = join(directory, 'repository'), origin = join(directory, 'origin.git');
  await mkdir(join(repository, 'src-tauri'), { recursive: true });
  const git = async (...args) => (await execute('git', args, { cwd: repository })).stdout.trimEnd();
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Release Test');
  await git('config', 'user.email', 'release-test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'tag.gpgsign', 'false');
  await git('init', '--bare', origin);
  await git('config', `url.${origin}.insteadOf`, 'https://github.com/listensay/StoryAgent.git');
  await git('remote', 'add', 'origin', 'https://github.com/listensay/StoryAgent.git');
  for (const [file, content] of Object.entries(sources)) await writeFile(join(repository, file), content);
  await git('add', '--', ...versionFiles, 'CHANGELOG.md');
  await git('commit', '-m', 'App changes');
  await git('push', 'origin', 'main');
  const calls = [], writes = [], logs = [], pauses = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (fail?.(command, args)) throw new Error('Command failed');
    if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') return git('config', '--get', 'remote.origin.url');
    if (command === 'git') return git(...args);
    if (command !== 'gh') return '';
    if (args[0] === 'api') return secrets;
    if (args[0] === 'run' && args[1] === 'list') return pendingRuns-- > 0 ? '[]' : '[{"databaseId":123}]';
    if (args[0] === 'release') {
      const version = args[2].slice(1), bundles = ['darwin_aarch64.app.tar.gz', 'darwin_x64.app.tar.gz', 'linux_amd64.AppImage', 'windows_x64-setup.exe'].map(suffix => `storyagent_${version}_${suffix}`);
      return JSON.stringify({ isDraft: draft, url: `https://github.com/listensay/StoryAgent/releases/tag/v${version}`, assets: ['latest.json', ...bundles, ...bundles.map(name => `${name}.sig`)].filter(name => name !== omitAsset).map(name => ({ name })) });
    }
    return '';
  };
  const dependencies = { run, read: (file, encoding) => readFile(join(repository, file), encoding), write: async (file, content) => { writes.push(file); await writeFile(join(repository, file), content); }, log: text => logs.push(text), pause: async ms => { pauses.push(ms); } };
  return { repository, origin, git, calls, writes, logs, pauses, dependencies };
}

it('increments from the highest stable tag and refuses reused or invalid versions', () => {
  expect(nextVersion('0.1.0', ['v0.3.4', 'v9.0.0-beta.1', 'unrelated'])).toBe('0.3.5');
  expect(nextVersion('0.3.4', [], 'minor')).toBe('0.4.0');
  expect(nextVersion('0.3.4', [], 'major')).toBe('1.0.0');
  expect(nextVersion('0.3.4', [], '0.5.0')).toBe('0.5.0');
  expect(() => nextVersion('0.1.0', ['v0.3.4'], '0.3.4')).toThrow('greater');
  expect(() => nextVersion('0.1.0', [], '01.2.0')).toThrow('stable version');
});

it('updates all application versions while preserving dependency versions and formatting', () => {
  const files = updateVersions(sources, '0.1.1');
  expect(JSON.parse(files['package-lock.json']).packages['node_modules/other'].version).toBe('0.1.0');
  expect(files['src-tauri/Cargo.lock']).toContain('name = "other"\nversion = "0.1.0"');
  expect(files['src-tauri/Cargo.lock']).toContain('name = "storyagent"\nversion = "0.1.1"');
  expect(files['src-tauri/Cargo.lock']).toContain('name = "third"\nversion = "0.1.0"');
  for (const file of versionFiles) expect(files[file].replaceAll('0.1.1', '0.1.0')).toBe(sources[file]);
  expect(() => updateVersions({ ...sources, 'package.json': sources['package.json'].replace('0.1.0', '0.2.0') }, '0.2.1')).toThrow('Synchronize');
});

it('previews a dirty working tree without writing files, contacting GitHub or pushing', async () => {
  const test = await fixture();
  await writeFile(join(test.repository, 'unfinished.txt'), 'User work');
  expect(await release({ ...test.dependencies, args: ['--dry-run'] })).toEqual({ version: '0.1.1', dryRun: true });
  expect(test.writes).toEqual([]);
  expect(test.calls.some(([command, action]) => command === 'gh' || action === 'push' || action === 'fetch')).toBe(false);
  expect(await readFile(join(test.repository, 'unfinished.txt'), 'utf8')).toBe('User work');
});

it('preserves staged user work and blocks release from a dirty working tree', async () => {
  const test = await fixture();
  await writeFile(join(test.repository, 'unfinished.txt'), 'User work');
  await test.git('add', 'unfinished.txt');
  const before = await test.git('status', '--porcelain');
  await expect(release(test.dependencies)).rejects.toThrow('clean working tree');
  expect(await test.git('status', '--porcelain')).toBe(before);
  expect(test.writes).toEqual([]);
});

it('blocks release from a feature branch or without the signing secret before writing versions', async () => {
  const branch = await fixture();
  await branch.git('checkout', '-b', 'codex/work');
  await expect(release(branch.dependencies)).rejects.toThrow('requires main');
  expect(branch.writes).toEqual([]);
  const unsigned = await fixture({ secrets: 'OTHER_SECRET' });
  await expect(release(unsigned.dependencies)).rejects.toThrow('TAURI_SIGNING_PRIVATE_KEY');
  expect(unsigned.writes).toEqual([]);
});

it('refuses to publish over remote main changes that have not been integrated', async () => {
  const test = await fixture();
  await test.git('checkout', '-b', 'other-publication');
  await writeFile(join(test.repository, 'remote-change.txt'), 'Remote change');
  await test.git('add', 'remote-change.txt');
  await test.git('commit', '-m', 'Other publication');
  await test.git('push', 'origin', 'HEAD:main');
  await test.git('checkout', 'main');
  await expect(release(test.dependencies)).rejects.toThrow();
  expect(test.writes).toEqual([]);
  expect(await test.git('status', '--porcelain')).toBe('');
  expect(await test.git('tag', '--list')).toBe('');
});

it('pushes matching main and annotated tag refs and waits for the complete published Release', async () => {
  const test = await fixture({ pendingRuns: 1 });
  const result = await release(test.dependencies);
  expect(result).toEqual({ version: '0.1.1', url: 'https://github.com/listensay/StoryAgent/releases/tag/v0.1.1' });
  expect(await test.git('status', '--porcelain')).toBe('');
  const commit = await test.git('rev-parse', 'HEAD');
  expect(await test.git('rev-parse', 'v0.1.1^{}')).toBe(commit);
  expect(await test.git('ls-remote', 'origin', 'refs/heads/main')).toContain(commit);
  expect(await test.git('ls-remote', 'origin', 'refs/tags/v0.1.1^{}')).toContain(commit);
  expect((await test.git('show', '--format=', '--name-only', 'HEAD')).split('\n').sort()).toEqual([...versionFiles].sort());
  expect(test.calls.find(call => call[0] === 'git' && call[1] === 'push')).toContain('--atomic');
  expect(test.calls.find(call => call[0] === 'gh' && call[1] === 'run' && call[2] === 'watch')).toContain('--exit-status');
  expect(test.pauses).toEqual([10000]);
});

it('leaves validation failures local without creating a tag or pushing', async () => {
  const test = await fixture({ fail: (command, args) => command === 'npm' && args[0] === 'test' });
  await expect(release(test.dependencies)).rejects.toThrow('Command failed');
  expect(await test.git('tag', '--list')).toBe('');
  expect(test.calls.some(call => call[0] === 'git' && ['push', 'commit'].includes(call[1]))).toBe(false);
  expect(test.logs.some(text => text.startsWith('Published'))).toBe(false);
});

it('blocks missing or oversized version records before changing versions or pushing', async () => {
  for (const changelog of ['## 0.1.0 · 2026-11-23\n- 旧版本。', `## 0.1.1 · 2026-11-23\n- ${'文'.repeat(81)}`]) {
    const test = await fixture();
    await writeFile(join(test.repository, 'CHANGELOG.md'), changelog);
    await test.git('add', 'CHANGELOG.md');
    await test.git('commit', '-m', 'Version record');
    await expect(release(test.dependencies)).rejects.toThrow();
    expect(test.writes).toEqual([]);
    expect(await test.git('tag', '--list')).toBe('');
    expect(test.calls.some(call => call[0] === 'git' && call[1] === 'push')).toBe(false);
  }
});

it('does not stage edits made by another process during validation', async () => {
  for (const file of ['concurrent.txt', 'package.json', 'CHANGELOG.md']) {
    const test = await fixture();
    const run = async (command, args) => {
      if (command === 'npm' && args[0] === 'test') await writeFile(join(test.repository, file), 'Concurrent work');
      return test.dependencies.run(command, args);
    };
    await expect(release({ ...test.dependencies, run })).rejects.toThrow('changed during validation');
    expect(await test.git('diff', '--cached', '--name-only')).toBe('');
    expect(await readFile(join(test.repository, file), 'utf8')).toBe('Concurrent work');
  }
});

it('does not report success when Actions fails', async () => {
  const failed = await fixture({ fail: (command, args) => command === 'gh' && args[1] === 'watch' });
  await expect(release(failed.dependencies)).rejects.toThrow('Command failed');
  expect(failed.logs.some(text => text.startsWith('Published'))).toBe(false);
  expect(await failed.git('tag', '--list')).toBe('v0.1.1');
}, 15000);

it.each([
  ['draft release', { draft: true }],
  ['missing manifest', { omitAsset: 'latest.json' }],
  ['missing signature', { omitAsset: 'storyagent_0.1.1_windows_x64-setup.exe.sig' }],
])('does not report success for a %s', async (_reason, options) => {
  const incomplete = await fixture(options);
  await expect(release(incomplete.dependencies)).rejects.toThrow('complete published');
  expect(incomplete.logs.some(text => text.startsWith('Published'))).toBe(false);
}, 15000);
