import { z } from 'zod';

export const imageConfigSchema = z.object({
  id: z.string(), baseUrl: z.string(), model: z.string(), hasKey: z.boolean(),
  size: z.enum(['1024x1536', '1024x1024', '1536x1024']),
  quality: z.enum(['auto', 'low', 'medium', 'high']),
});
export const coverDraftSchema = z.object({
  selectedId: z.string(),
  rounds: z.array(z.object({ id: z.string(), instruction: z.string(), prompt: z.string(), dataUrl: z.string(), createdAt: z.string() })).max(6),
});
export type ImageConfig = z.infer<typeof imageConfigSchema>;
export type CoverDraft = z.infer<typeof coverDraftSchema>;
export const imageProviderSchema = imageConfigSchema.omit({ model: true, size: true, quality: true }).extend({
  name: z.string(), models: z.array(z.string()), enabled: z.boolean(),
});
export const imageSelectionSchema = z.object({ providerId: z.string(), model: z.string() });
export const coverOptionsSchema = imageConfigSchema.pick({ size: true, quality: true });
export const defaultCoverOptions = (): z.infer<typeof coverOptionsSchema> => ({ size: '1024x1536', quality: 'auto' });
export type ImageProvider = z.infer<typeof imageProviderSchema>;
export type ImageSelection = z.infer<typeof imageSelectionSchema>;

export function normalizeImageSelection(selection: ImageSelection, providers: ImageProvider[]): ImageSelection {
  const available = providers.filter(provider => provider.enabled && provider.models.length);
  const provider = available.find(provider => provider.id === selection.providerId) ?? available[0];
  return provider ? { providerId: provider.id, model: provider.models.includes(selection.model) ? selection.model : provider.models[0] } : { providerId: '', model: '' };
}
export function validateImageProvider(provider: ImageProvider) {
  if (!imageProviderSchema.safeParse(provider).success || !provider.id || !provider.name.trim()) throw new Error('请填写图片供应商名称');
  imageAPIBase(provider);
  if (!provider.models.length || provider.models.some(model => !model.trim())) throw new Error('请至少选择一个图片模型');
}

export function imageAPIBase(config: Pick<ImageConfig, 'baseUrl'>) {
  let url: URL;
  try { url = new URL(config.baseUrl.trim()); } catch { throw new Error('请填写有效的图片 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写有效的图片 API 地址');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(?:images\/(?:generations|edits)|models)$/, '');
  return url.origin + (path || '/v1');
}
export function validateImageConfig(config: ImageConfig) {
  if (!imageConfigSchema.safeParse(config).success || !config.model.trim() || !config.id) throw new Error('请检查图片生成设置');
  imageAPIBase(config);
}

export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export function imageMime(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) throw new Error('封面图片须小于 10 MB');
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('请选择 PNG、JPEG 或 WebP 图片');
}
export function imageDataUrl(bytes: Uint8Array): string {
  const mime = imageMime(bytes);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export function imageBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match || match[2].length > Math.ceil(MAX_COVER_BYTES / 3) * 4) throw new Error('封面图片数据无效');
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error('封面图片数据无效'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  imageMime(bytes);
  return bytes;
}

export function validateCoverImage(dataUrl: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(signal?.reason); };
    image.onload = () => { cleanup(); if (image.naturalWidth && image.naturalHeight) resolve(); else reject(new Error('封面图片无法读取')); };
    image.onerror = () => { cleanup(); reject(new Error('封面图片无法读取')); };
    signal?.addEventListener('abort', abort, { once: true });
    image.src = dataUrl;
  });
}
