import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseChangelog, releaseNotes, releaseRecord } from '../src/changelog.mjs';

export function validateReleaseVersion(tag, versions) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '') || versions.some(version => version !== tag.slice(1))) {
    throw new Error('Release tag must match the versions in package.json, Cargo.toml and tauri.conf.json.');
  }
}

export async function createUpdaterManifest({ directory, repository, tag, productName, version, changelog }) {
  validateReleaseVersion(tag, [version]);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid GitHub repository.');
  const record = releaseRecord(changelog, version);
  const prefix = `${productName}_${version}_`;
  const bundles = {
    'darwin-aarch64': `${prefix}darwin_aarch64.app.tar.gz`,
    'darwin-x86_64': `${prefix}darwin_x64.app.tar.gz`,
    'linux-x86_64': `${prefix}linux_amd64.AppImage`,
    'windows-x86_64': `${prefix}windows_x64-setup.exe`,
  };
  const platforms = {};
  for (const [platform, name] of Object.entries(bundles)) {
    const bytes = await readFile(resolve(directory, name));
    const signature = (await readFile(resolve(directory, `${name}.sig`), 'utf8')).trim();
    if (!bytes.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`Invalid updater bundle or signature for ${platform}.`);
    platforms[platform] = { signature, url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}` };
  }
  return { version, notes: releaseNotes(record), changelog: parseChangelog(changelog), pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Usage: node scripts/updater-manifest.mjs <bundle-directory> <output-file>');
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const manifest = await createUpdaterManifest({ directory, repository: process.env.GITHUB_REPOSITORY, tag: process.env.RELEASE_TAG, productName: config.productName, version: config.version, changelog });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
}
