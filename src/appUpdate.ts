import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { type DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { validateChangelog, type ChangelogEntry } from './changelog.mjs';

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'unpublished' | 'available' | 'downloading' | 'ready' | 'waiting' | 'installing' | 'restarting' | 'error';
export type UpdateState = { status: UpdateStatus; currentVersion: string; version: string; downloaded: number; total?: number; error: string; notes: string; releases: ChangelogEntry[] };
export type UpdateHandle = Pick<Update, 'version' | 'download' | 'install' | 'close'> & Partial<Pick<Update, 'body' | 'rawJson'>>;
export type UpdateDependencies = {
  getVersion: () => Promise<string>;
  check: () => Promise<UpdateHandle | null | 'unpublished'>;
  canRestart: () => Promise<boolean>;
  prepareRestart: () => Promise<boolean>;
  releaseRestart: () => void;
  relaunch: () => Promise<void>;
};

export function updatePercent(state: Pick<UpdateState, 'downloaded' | 'total'>): number | undefined {
  if (!state.total || !Number.isFinite(state.total) || state.total < 0) return undefined;
  return Math.min(100, Math.max(0, Math.round(state.downloaded / state.total * 100)));
}

export class AppUpdateController {
  private state: UpdateState = { status: 'idle', currentVersion: '', version: '', downloaded: 0, error: '', notes: '', releases: [] };
  private listeners = new Set<() => void>();
  private update?: UpdateHandle;
  private downloaded = false;
  private installed = false;
  private busy = false;
  private checking = false;
  private lastCheck = -Infinity;
  private epoch = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private dependencies: UpdateDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  start() {
    if (this.timers.length) return;
    this.timers.push(setTimeout(this.refresh, 0));
    this.timers.push(setInterval(this.refresh, 60_000));
    this.timers.push(setInterval(() => { if (this.state.status === 'waiting') void this.install(); }, 1000));
  }
  refresh = () => {
    if (this.timers.length && Date.now() - this.lastCheck >= 15_000) void this.check(true);
  };
  stop() {
    this.epoch++;
    this.timers.forEach(clearTimeout); this.timers = [];
    if (!this.busy) void this.update?.close().catch(() => {});
    this.update = undefined; this.busy = false; this.checking = false; this.lastCheck = -Infinity;
    this.downloaded = false; this.installed = false;
    this.dependencies.releaseRestart();
  }

  async check(background = false) {
    if (this.busy || this.checking || (this.update && this.state.status !== 'available')) return;
    const epoch = this.epoch;
    this.checking = true; this.lastCheck = Date.now();
    if (!this.update && (!background || this.state.status === 'idle')) this.publish({ status: 'checking', error: '' });
    try {
      const currentVersion = this.state.currentVersion || await this.dependencies.getVersion();
      if (epoch !== this.epoch) return;
      if (!this.state.currentVersion) this.publish({ currentVersion });
      const update = await this.dependencies.check();
      if (epoch !== this.epoch || this.busy || (this.update && this.state.status !== 'available')) {
        if (update && update !== 'unpublished') await update.close();
        return;
      }
      const previous = this.update;
      this.update = update === 'unpublished' ? undefined : update ?? undefined;
      if (previous && previous !== this.update) void previous.close().catch(() => {});
      let releases: ChangelogEntry[] = [];
      try { if (this.update?.rawJson?.changelog) releases = validateChangelog(this.update.rawJson.changelog); } catch { /* Older or malformed manifests can still supply release notes. */ }
      this.publish({ status: update === 'unpublished' ? 'unpublished' : update ? 'available' : 'current', currentVersion, version: this.update?.version ?? '', notes: this.update?.body ?? '', releases, error: '' });
    } catch (error) {
      if (epoch === this.epoch && !this.update) this.publish({ status: 'error', error: updateCheckError(error) });
    } finally { if (epoch === this.epoch) this.checking = false; }
  }

  async activate() {
    if (this.busy) return;
    if (this.state.status === 'waiting') { this.publish({ status: 'ready' }); return; }
    if (!this.update) await this.check();
    if (this.update) await this.install();
  }

  private async install() {
    if (this.busy || !this.update) return;
    const update = this.update, epoch = this.epoch;
    let failure = '更新下载失败';
    this.busy = true;
    try {
      if (!this.downloaded) {
        this.publish({ status: 'downloading', downloaded: 0, total: undefined, error: '' });
        const progress = (event: DownloadEvent) => {
          if (epoch !== this.epoch) return;
          if (event.event === 'Started') this.publish({ downloaded: 0, total: event.data.contentLength });
          if (event.event === 'Progress') this.publish({ downloaded: this.state.downloaded + event.data.chunkLength });
        };
        // download() verifies the signature before the package can be installed.
        await update.download(progress, { timeout: 15 * 60 * 1000 });
        if (epoch !== this.epoch) return;
        this.downloaded = true;
      }
      failure = '无法准备更新';
      if (!await this.dependencies.canRestart()) {
        if (epoch === this.epoch) this.publish({ status: 'waiting', error: '' });
        return;
      }
      if (epoch !== this.epoch) return;
      this.publish({ status: 'installing', error: '' });
      failure = '工作区保存失败';
      if (!await this.dependencies.prepareRestart()) {
        this.dependencies.releaseRestart();
        if (epoch === this.epoch) this.publish({ status: 'waiting' });
        return;
      }
      if (epoch !== this.epoch) return;
      if (!this.installed) {
        failure = '更新安装失败';
        await update.install();
        if (epoch !== this.epoch) return;
        this.installed = true;
      }
      failure = '软件重启失败';
      this.publish({ status: 'restarting' });
      await this.dependencies.relaunch();
    } catch {
      if (epoch === this.epoch) { this.dependencies.releaseRestart(); this.publish({ status: 'error', error: failure }); }
    } finally {
      if (epoch === this.epoch) this.busy = false;
      else { this.dependencies.releaseRestart(); await update.close().catch(() => {}); }
    }
  }
}

export function createAppUpdater(restart: Pick<UpdateDependencies, 'canRestart' | 'prepareRestart' | 'releaseRestart'>) {
  return new AppUpdateController({ ...restart, getVersion, check: checkAppUpdate, relaunch });
}

const sourceErrors = ['更新地址未配置', '更新地址无效', '更新信息尚未发布', '更新信息无效', '更新仓库不可访问', '更新检查请求受限，请稍后重试', '更新服务器暂时不可用', '无法连接更新服务器', '更新检查超时'];
export function updateCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (sourceErrors.includes(message) || /^更新服务器响应异常（HTTP \d{3}）$/.test(message)) return message;
  if (/platforms?.*not found|fallback platforms.*found/.test(message)) return '暂无适用当前系统的更新包';
  if (/timed?\s*out|timeout/i.test(message)) return '更新检查超时';
  if (/error sending request|network|connect|dns|certificate|tls/i.test(message)) return '无法连接更新服务器';
  return '检查更新失败';
}

export async function checkAppUpdate(
  pluginCheck: () => Promise<UpdateHandle | null> = async () => {
    const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>('check_app_update');
    return metadata ? new Update(metadata) : null;
  },
  diagnose: () => Promise<string> = () => invoke('diagnose_update_source'),
): Promise<UpdateHandle | null | 'unpublished'> {
  try { return await pluginCheck(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Could not fetch a valid release JSON from the remote') {
      if (await diagnose() === 'unpublished') return 'unpublished';
    }
    throw error;
  }
}
