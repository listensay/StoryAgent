import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { build, signingEnvironment } from './build.mjs';

it('loads the existing local key path without reading or modifying its contents', async () => {
  const env = { PATH: '/toolchain' }, userDirectory = join('test', 'user'), checkAccess = vi.fn().mockResolvedValue(undefined);
  const configured = await signingEnvironment({ env, userDirectory, checkAccess });
  expect(configured).toEqual({ ...env, TAURI_SIGNING_PRIVATE_KEY: join(userDirectory, '.tauri', 'storyagent.key'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' });
  expect(checkAccess).toHaveBeenCalledOnce();
  expect(env).toEqual({ PATH: '/toolchain' });
});

it('preserves explicit CI key content and encrypted key passwords', async () => {
  const checkAccess = vi.fn(), env = { CI: 'true', TAURI_SIGNING_PRIVATE_KEY: 'test-key-content', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'test-key-password' };
  expect(await signingEnvironment({ env, checkAccess })).toEqual(env);
  expect(checkAccess).not.toHaveBeenCalled();
  const local = await signingEnvironment({ env: { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'test-password' }, checkAccess: vi.fn() });
  expect(local.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('test-password');
});

it('fails before starting a build when the key is missing and never uses a local key in CI', async () => {
  const checkAccess = vi.fn().mockRejectedValue(new Error('Missing'));
  await expect(signingEnvironment({ env: {}, checkAccess })).rejects.toThrow('未找到签名私钥');
  checkAccess.mockClear();
  await expect(signingEnvironment({ env: { CI: 'true' }, checkAccess })).rejects.toThrow('Actions Secret');
  expect(checkAccess).not.toHaveBeenCalled();
  const launch = vi.fn();
  await expect(build({ env: {}, signing: () => signingEnvironment({ env: {}, checkAccess }), launch })).rejects.toThrow('未找到签名私钥');
  expect(launch).not.toHaveBeenCalled();
});

it('passes arguments and signing environment to Tauri and propagates build failures', async () => {
  const env = { TAURI_SIGNING_PRIVATE_KEY: 'test-key' }, signing = vi.fn().mockResolvedValue(env);
  const launch = vi.fn(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 1)); return child; });
  expect(await build({ args: ['--bundles', 'app'], env: {}, signing, launch })).toBe(1);
  const [executable, args, options] = launch.mock.calls[0];
  expect(executable).toBe(process.execPath);
  expect(args.slice(1)).toEqual(['build', '--bundles', 'app']);
  expect(options).toEqual({ env, stdio: 'inherit', shell: false });
});

it('allows help and compilation without bundles when no signing key is configured', async () => {
  const signing = vi.fn(), launch = vi.fn(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; });
  for (const argument of ['--help', '--no-bundle']) expect(await build({ args: [argument], env: {}, signing, launch })).toBe(0);
  expect(signing).not.toHaveBeenCalled();
});
