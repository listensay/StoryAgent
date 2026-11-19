import { type Ranking, type RankingOptions, rankingSchema } from './rankings';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { emptyWorkspace, parseWorkspace, type Workspace, uid } from './domain';

export async function loadWorkspace(): Promise<Workspace> {
  const raw = await invoke<string | null>('load_workspace');
  const state = raw ? parseWorkspace(raw) : emptyWorkspace();
  await refreshCredentials(state);
  return state;
}
export async function refreshCredentials(state: Workspace) {
  await Promise.all(state.providers.map(async p => {
    try { p.hasKey = await invoke<boolean>('credential_exists', { id: p.id }); }
    catch { p.hasKey = false; }
  }));
}
let saveQueue = Promise.resolve();
export function saveWorkspace(state: Workspace): Promise<void> {
  const raw = JSON.stringify(state);
  saveQueue = saveQueue.catch(() => {}).then(() => invoke<void>('save_workspace', { data: raw }));
  return saveQueue;
}
export async function saveCredential(id: string, key: string) {
  await invoke('save_credential', { id, secret: key });
}
type Request = { url: string; method?: string; headers?: Record<string, string>; body?: string; providerId?: string; keyHeader?: string; keyPrefix?: string; signal?: AbortSignal; onChunk?: (text: string) => void; binary?: boolean };
export async function http(request: Request): Promise<{ text: string; bytes: Uint8Array; status: number; url?: string }> {
  request.signal?.throwIfAborted();
  const id = uid();
  const decoder = new TextDecoder();
  const unlisten = request.onChunk ? await listen<{ id: string; bytes: number[] }>('http-chunk', event => { if (event.payload.id === id) request.onChunk?.(decoder.decode(new Uint8Array(event.payload.bytes), { stream: true })); }) : () => {};
  const abort = () => { void invoke('cancel_http', { id }); };
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    request.signal?.throwIfAborted();
    const response = await invoke<{ text: string; bytes: number[]; status: number }>('http_request', { request: { id, url: request.url, method: request.method ?? 'GET', headers: request.headers ?? {}, body: request.body ?? null, providerId: request.providerId ?? null, keyHeader: request.keyHeader ?? null, keyPrefix: request.keyPrefix ?? null, stream: !!request.onChunk, binary: !!request.binary } });
    const tail = decoder.decode(); if (tail) request.onChunk?.(tail);
    request.signal?.throwIfAborted();
    if (response.status >= 300) throw new Error(errorText(response.text, response.status));
    return { ...response, bytes: new Uint8Array(response.bytes) };
  } finally { unlisten(); request.signal?.removeEventListener('abort', abort); }
}
function errorText(text: string, status: number) {
  try { const json = JSON.parse(text); return `HTTP ${status}：${json.error?.message ?? json.message ?? text.slice(0, 300)}`; } catch { return `HTTP ${status}：${text.replace(/<[^>]+>/g, '').slice(0, 200)}`; }
}
export type InputFile = { name: string; bytes: Uint8Array };
export async function pickFiles(options: { folder?: boolean; skills?: boolean } = {}): Promise<InputFile[]> {
  const files = await invoke<{ name: string; bytes: number[] }[]>('pick_files', { folder: !!options.folder, skills: !!options.skills });
  return files.map(f => ({ ...f, bytes: new Uint8Array(f.bytes) }));
}
export async function exportFile(name: string, content: string): Promise<boolean> {
  return invoke('export_file', { name, content });
}
export async function fetchPage(url: string): Promise<{ title: string; text: string; links: { title: string; url: string }[] }> {
  return invoke('fetch_page', { url });
}

export function rankingCategories(channel: string, board: string): Promise<{ id: string; name: string }[]> {
  return invoke('ranking_categories', { channel, board });
}
export async function collectRanking(options: RankingOptions, signal: AbortSignal): Promise<Ranking> {
  signal.throwIfAborted();
  const id = uid();
  const abort = () => { void invoke('cancel_http', { id }).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const result = await invoke<Omit<Ranking, 'collectedAt'>>('collect_ranking', { request: { ...options, id } });
    signal.throwIfAborted();
    return rankingSchema.parse({ ...result, collectedAt: new Date().toISOString() });
  } finally { signal.removeEventListener('abort', abort); }
}
