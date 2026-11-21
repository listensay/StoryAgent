import { defaultAdvanced, type Project } from './domain';
import { imageAPIBase, imageBytes, imageDataUrl, imageMime, validateImageConfig, type ImageConfig, type ImageProvider } from './coverData';
import { http } from './platform';
import { getModels } from './ai';

export function getImageModels(provider: ImageProvider, signal: AbortSignal, apiKey?: string) {
  return getModels({ ...provider, baseUrl: imageAPIBase(provider), protocol: 'chat', maxRetries: 0, advanced: defaultAdvanced() }, signal, apiKey);
}

export function coverPrompt(project: Pick<Project, 'title' | 'genre' | 'theme' | 'synopsis'>, instruction: string, history: string[]) {
  if (!instruction.trim() || instruction.length > 4000) throw new Error('封面要求须为 1 至 4000 字符');
  return [
    '设计小说封面。书名使用准确、清晰的中文排版，画面与题材、主题和简介一致。依据本次要求调整构图、配色、人物、风格和文字。',
    `书名：${project.title}\n题材：${project.genre}\n主题：${project.theme}\n简介：${project.synopsis.slice(0, 8000)}`,
    history.length ? `此前要求：\n${history.slice(-6).map(text => text.slice(0, 4000)).join('\n')}` : '',
    `本次要求：${instruction.trim()}`,
  ].filter(Boolean).join('\n\n');
}

export async function generateCover(config: ImageConfig, prompt: string, reference: string, signal: AbortSignal): Promise<{ dataUrl: string; prompt: string }> {
  validateImageConfig(config);
  signal.throwIfAborted();
  const base = imageAPIBase(config);
  const fields = { model: config.model.trim(), prompt, size: config.size, quality: config.quality, n: '1', output_format: 'png' };
  const referenceBytes = reference ? imageBytes(reference) : undefined;
  const referenceMime = referenceBytes ? imageMime(referenceBytes) : '';
  const response = referenceBytes
    ? await http({ url: base + '/images/edits', method: 'POST', providerId: config.id, signal, form: { fields, files: [{ field: 'image[]', name: 'cover.' + referenceMime.split('/')[1], mime: referenceMime, bytes: Array.from(referenceBytes) }] } })
    : await http({ url: base + '/images/generations', method: 'POST', providerId: config.id, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, n: 1 }) });
  signal.throwIfAborted();
  let data;
  try { data = JSON.parse(response.text); } catch { throw new Error('图片接口未返回有效数据'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('图片接口未返回有效数据');
  if (data.error) throw new Error(typeof data.error.message === 'string' ? data.error.message : '封面生成失败');
  const image = data.data?.[0];
  let bytes: Uint8Array;
  if (typeof image?.b64_json === 'string') bytes = imageBytes(`data:image/png;base64,${image.b64_json}`);
  else if (typeof image?.url === 'string') {
    let url: URL;
    try { url = new URL(image.url); } catch { throw new Error('图片接口返回的地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片接口返回的地址无效');
    bytes = (await http({ url: url.href, signal, binary: true })).bytes;
  } else throw new Error('图片接口未返回图片');
  signal.throwIfAborted();
  return { dataUrl: imageDataUrl(bytes), prompt: typeof image.revised_prompt === 'string' ? image.revised_prompt : prompt };
}
