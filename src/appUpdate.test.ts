import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateController, checkAppUpdate, updateCheckError, updatePercent, type UpdateDependencies, type UpdateHandle } from './appUpdate';

function fixture() {
  const order: string[] = [];
  const update: UpdateHandle = {
    version: '0.2.0',
    download: vi.fn(async () => { order.push('download'); }),
    install: vi.fn(async () => { order.push('install'); }),
    close: vi.fn(async () => {}),
  };
  const dependencies: UpdateDependencies = {
    getVersion: vi.fn(async () => '0.1.0'), check: vi.fn(async () => update),
    canRestart: vi.fn(async () => true),
    prepareRestart: vi.fn(async () => { order.push('save'); return true; }),
    releaseRestart: vi.fn(), relaunch: vi.fn(async () => { order.push('relaunch'); }),
  };
  const controller = new AppUpdateController(dependencies);
  return { controller, update, dependencies, order };
}

afterEach(() => { vi.useRealTimers(); });

describe('desktop updates', () => {
  it('checks in the background without installing', async () => {
    const { controller, dependencies, update } = fixture();
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({ status: 'available', currentVersion: '0.1.0', version: '0.2.0' });
    expect(update.download).not.toHaveBeenCalled();
    await controller.check();
    expect(dependencies.check).toHaveBeenCalledTimes(1);
  });

  it('checks, downloads, saves, installs and relaunches with one click', async () => {
    const { controller, order } = fixture();
    await controller.activate();
    expect(order).toEqual(['download', 'save', 'install', 'relaunch']);
    expect(controller.getSnapshot().status).toBe('restarting');
  });

  it('does not install when there is no new release', async () => {
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.check).mockResolvedValue(null);
    await controller.activate();
    expect(controller.getSnapshot().status).toBe('current');
    expect(update.download).not.toHaveBeenCalled();
  });

  it('shows an unpublished repository distinctly and can discover a later release', async () => {
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.check).mockResolvedValueOnce('unpublished');
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'unpublished', currentVersion: '0.1.0', version: '', error: '' });
    expect(update.download).not.toHaveBeenCalled();
    await controller.check();
    expect(controller.getSnapshot().status).toBe('available');
    expect(dependencies.check).toHaveBeenCalledTimes(2);
  });

  it('diagnoses missing GitHub metadata without changing the successful plugin update path', async () => {
    const { update } = fixture();
    const diagnose = vi.fn(async () => 'unpublished');
    expect(await checkAppUpdate(async () => update, diagnose)).toBe(update);
    expect(await checkAppUpdate(async () => null, diagnose)).toBe(null);
    expect(diagnose).not.toHaveBeenCalled();
    const missing = async () => { throw 'Could not fetch a valid release JSON from the remote'; };
    expect(await checkAppUpdate(missing, diagnose)).toBe('unpublished');
    await expect(checkAppUpdate(missing, async () => { throw '更新信息尚未发布'; })).rejects.toBe('更新信息尚未发布');
    await expect(checkAppUpdate(async () => { throw new Error('network'); }, diagnose)).rejects.toThrow('network');
    expect(diagnose).toHaveBeenCalledTimes(1);
  });

  it('keeps missing release assets and network failures as retryable errors', async () => {
    const { controller, dependencies } = fixture();
    for (const message of ['更新信息尚未发布', '更新检查请求受限，请稍后重试', '更新仓库不可访问']) {
      vi.mocked(dependencies.check).mockRejectedValueOnce(message);
      await controller.check();
      expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: message });
    }
    expect(updateCheckError(new Error('error sending request'))).toBe('无法连接更新服务器');
    expect(updateCheckError('the platform `darwin-aarch64` was not found in the response `platforms` object')).toBe('暂无适用当前系统的更新包');
    expect(updateCheckError('request timed out')).toBe('更新检查超时');
  });

  it('retries a failed check and prevents duplicate requests', async () => {
    const { controller, dependencies } = fixture();
    vi.mocked(dependencies.check).mockRejectedValueOnce(new Error('offline'));
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: '检查更新失败' });
    await Promise.all([controller.check(), controller.check()]);
    expect(dependencies.check).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('available');
  });

  it('reports progress even when download size is unknown', async () => {
    const { controller, update } = fixture();
    const seen: (number | undefined)[] = [];
    controller.subscribe(() => { if (controller.getSnapshot().status === 'downloading') seen.push(updatePercent(controller.getSnapshot())); });
    vi.mocked(update.download).mockImplementation(async callback => {
      callback?.({ event: 'Started', data: {} });
      callback?.({ event: 'Progress', data: { chunkLength: 50 } });
      callback?.({ event: 'Started', data: { contentLength: 100 } });
      callback?.({ event: 'Progress', data: { chunkLength: 50 } });
      callback?.({ event: 'Progress', data: { chunkLength: 200 } });
      callback?.({ event: 'Finished' });
    });
    await controller.activate();
    expect(seen).toEqual([undefined, undefined, undefined, 0, 50, 100]);
    expect(updatePercent({ downloaded: 10, total: Infinity })).toBeUndefined();
  });

  it('does not save or restart after a download or signature failure', async () => {
    const { controller, update, dependencies } = fixture();
    vi.mocked(update.download).mockRejectedValueOnce(new Error('signature mismatch'));
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: '更新下载失败' });
    expect(dependencies.prepareRestart).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(dependencies.relaunch).not.toHaveBeenCalled();
    await controller.activate();
    expect(update.download).toHaveBeenCalledTimes(2);
    expect(dependencies.relaunch).toHaveBeenCalledTimes(1);
  });

  it('waits for active work, then installs without downloading again', async () => {
    vi.useFakeTimers();
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.canRestart).mockResolvedValue(false);
    controller.start();
    await controller.activate();
    expect(controller.getSnapshot().status).toBe('waiting');
    expect(dependencies.prepareRestart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(update.install).not.toHaveBeenCalled();
    vi.mocked(dependencies.canRestart).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('can cancel waiting and retain the verified package', async () => {
    vi.useFakeTimers();
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.canRestart).mockResolvedValue(false);
    controller.start();
    await controller.activate();
    await controller.activate();
    expect(controller.getSnapshot().status).toBe('ready');
    await vi.advanceTimersByTimeAsync(3000);
    expect(update.install).not.toHaveBeenCalled();
    vi.mocked(dependencies.canRestart).mockResolvedValue(true);
    await controller.activate();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('rechecks active tasks before saving', async () => {
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.prepareRestart).mockResolvedValue(false);
    await controller.activate();
    expect(controller.getSnapshot().status).toBe('waiting');
    expect(dependencies.releaseRestart).toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
  });

  it('does not install if saving fails, and permits retry', async () => {
    const { controller, dependencies, update } = fixture();
    vi.mocked(dependencies.prepareRestart).mockRejectedValueOnce(new Error('disk full'));
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: '工作区保存失败' });
    expect(dependencies.releaseRestart).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled();
    await controller.activate();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it('does not relaunch after an installation failure', async () => {
    const { controller, update, dependencies } = fixture();
    vi.mocked(update.install).mockRejectedValueOnce(new Error('not writable'));
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: '更新安装失败' });
    expect(dependencies.relaunch).not.toHaveBeenCalled();
    await controller.activate();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(dependencies.relaunch).toHaveBeenCalledTimes(1);
  });

  it('retries relaunch without reinstalling and saves new edits first', async () => {
    const { controller, dependencies, update, order } = fixture();
    vi.mocked(dependencies.relaunch).mockRejectedValueOnce(new Error('cannot relaunch'));
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: '软件重启失败' });
    await controller.activate();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['download', 'save', 'install', 'save', 'relaunch']);
  });

  it('discards a late result after disposal', async () => {
    const { controller, dependencies, update } = fixture();
    let resolve!: (value: UpdateHandle) => void;
    vi.mocked(dependencies.check).mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = controller.check();
    await Promise.resolve();
    controller.stop();
    resolve(update); await pending;
    expect(update.close).toHaveBeenCalledTimes(1);
    expect(update.download).not.toHaveBeenCalled();
  });

  it('checks at startup and every six hours, and clears timers on stop', async () => {
    vi.useFakeTimers();
    const { controller, dependencies } = fixture();
    vi.mocked(dependencies.check).mockResolvedValue(null);
    controller.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(dependencies.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 2500);
    expect(dependencies.check).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(dependencies.check).toHaveBeenCalledTimes(2);
  });
});
