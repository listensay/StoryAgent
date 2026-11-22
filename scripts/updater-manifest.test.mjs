import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createUpdaterManifest, validateReleaseVersion } from './updater-manifest.mjs';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'storyagent-manifest-test-'));
  directories.push(directory);
  const options = { directory, repository: 'listensay/StoryAgent', tag: 'v0.2.0', version: '0.2.0', productName: 'storyagent' };
  const names = ['darwin_aarch64.app.tar.gz', 'darwin_x64.app.tar.gz', 'linux_amd64.AppImage', 'windows_x64-setup.exe'].map(suffix => `storyagent_0.2.0_${suffix}`);
  for (const name of names) {
    await writeFile(join(directory, name), 'signed bundle');
    await writeFile(join(directory, `${name}.sig`), 'c2lnbmF0dXJl\n');
  }
  return { options, names };
}

it('maps all desktop platforms to version-specific GitHub downloads and signature content', async () => {
  const { options } = await fixture();
  const manifest = await createUpdaterManifest(options);
  expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']);
  expect(manifest.platforms['darwin-x86_64']).toEqual({ signature: 'c2lnbmF0dXJl', url: 'https://github.com/listensay/StoryAgent/releases/download/v0.2.0/storyagent_0.2.0_darwin_x64.app.tar.gz' });
  expect(manifest.version).toBe('0.2.0');
});

it('refuses to publish a partial platform manifest', async () => {
  const { options, names } = await fixture();
  await rm(join(options.directory, `${names[3]}.sig`));
  await expect(createUpdaterManifest(options)).rejects.toThrow();
});

it('rejects empty packages or malformed signatures', async () => {
  const { options, names } = await fixture();
  await writeFile(join(options.directory, `${names[0]}.sig`), '');
  await expect(createUpdaterManifest(options)).rejects.toThrow('Invalid updater bundle');
  await writeFile(join(options.directory, `${names[0]}.sig`), 'c2lnbmF0dXJl');
  await writeFile(join(options.directory, names[0]), '');
  await expect(createUpdaterManifest(options)).rejects.toThrow('Invalid updater bundle');
});

it('requires synchronized versions and validates release destinations', async () => {
  expect(() => validateReleaseVersion('v0.2.0', ['0.2.0', '0.1.0'])).toThrow('Release tag');
  expect(() => validateReleaseVersion('main', ['0.2.0'])).toThrow('Release tag');
  expect(() => validateReleaseVersion('v0.2.0-beta.1', ['0.2.0-beta.1'])).not.toThrow();
  const { options } = await fixture();
  await expect(createUpdaterManifest({ ...options, repository: '../other/repo' })).rejects.toThrow('Invalid GitHub');
});
