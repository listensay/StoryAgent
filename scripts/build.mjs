import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export async function signingEnvironment({ env = process.env, userDirectory = homedir(), checkAccess = access } = {}) {
  const configured = { ...env };
  if (configured.TAURI_SIGNING_PRIVATE_KEY) return configured;
  if (configured.CI || configured.GITHUB_ACTIONS) throw new Error('构建环境缺少 TAURI_SIGNING_PRIVATE_KEY，请配置仓库 Actions Secret。');
  const keyPath = join(userDirectory, '.tauri', 'storyagent.key');
  try { await checkAccess(keyPath, constants.R_OK); }
  catch { throw new Error(`未找到签名私钥 ${keyPath}，请设置 TAURI_SIGNING_PRIVATE_KEY 为现有私钥的路径或内容。`); }
  configured.TAURI_SIGNING_PRIVATE_KEY = keyPath;
  configured.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
  return configured;
}

export async function build({ args = [], env = process.env, signing = signingEnvironment, launch = spawn } = {}) {
  const needsSigning = !args.some(arg => ['--help', '-h', '--no-bundle'].includes(arg));
  const buildEnv = needsSigning ? await signing({ env }) : { ...env };
  const cli = require.resolve('@tauri-apps/cli/tauri.js');
  return new Promise((accept, reject) => {
    const child = launch(process.execPath, [cli, 'build', ...args], { env: buildEnv, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code, signal) => signal ? reject(new Error(`构建被 ${signal} 中断。`)) : accept(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  build({ args: process.argv.slice(2) }).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
