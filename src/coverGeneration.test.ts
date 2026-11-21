import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, newProject, parseWorkspace } from './domain';
import { imageAPIBase, imageBytes, imageDataUrl, MAX_COVER_BYTES, normalizeImageSelection, validateCoverImage, validateImageConfig, validateImageProvider, type ImageConfig, type ImageProvider } from './coverData';
import { coverPrompt, generateCover, getImageModels } from './coverGeneration';
import { http } from './platform';

vi.mock('./platform', () => ({ http: vi.fn() }));
const config: ImageConfig = { id: 'cover-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.5-sunburst', hasKey: true, size: '1024x1536', quality: 'auto' };
const provider: ImageProvider = { id: config.id, name: '图片供应商', baseUrl: config.baseUrl, hasKey: true, enabled: true, models: [config.model, 'gpt-image-1.5'] };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTyoAAAAASUVORK5CYII=';
const source = `data:image/png;base64,${png}`;
const response = (value: unknown) => ({ text: JSON.stringify(value), bytes: new Uint8Array(), status: 200 });
const result = () => response({ data: [{ b64_json: png }] });

beforeEach(() => vi.mocked(http).mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('封面数据与设置', () => {
  it('兼容无封面的旧小说，备份保留封面、版本和独立图片设置', () => {
    const project = newProject('测试', 'long');
    const legacy = { ...project, cover: undefined };
    expect(parseWorkspace(JSON.stringify({ ...emptyWorkspace(), projects: [legacy] })).projects[0].cover).toBe('');
    project.cover = source;
    project.coverDraft = { selectedId: 'one', rounds: [{ id: 'one', instruction: '橙色', prompt: '提示', dataUrl: source, createdAt: project.createdAt }] };
    const state = { ...emptyWorkspace(), projects: [project], imageProviders: [provider], imageSelection: { providerId: provider.id, model: config.model }, coverOptions: { size: '1024x1024' as const, quality: 'high' as const } };
    expect(parseWorkspace(JSON.stringify(state))).toEqual(state);
    expect(JSON.stringify(state)).not.toContain('apiKey');
  });
  it('迁移旧图片接口并保留供应商 ID、模型、密钥状态、尺寸与画质', () => {
    const legacy = { ...emptyWorkspace(), imageConfig: { ...config, quality: 'high' } } as Record<string, unknown>;
    delete legacy.imageSelection; delete legacy.coverOptions;
    const restored = parseWorkspace(JSON.stringify(legacy));
    expect(restored.imageProviders).toEqual([{ id: config.id, name: 'OpenAI GPT Image', baseUrl: config.baseUrl, hasKey: true, enabled: true, models: [config.model] }]);
    expect(restored.imageSelection).toEqual({ providerId: config.id, model: config.model });
    expect(restored.coverOptions).toEqual({ size: config.size, quality: 'high' });
    expect(restored).not.toHaveProperty('imageConfig');
    expect(restored.imageProviders[0]).not.toHaveProperty('size');
    expect(parseWorkspace(JSON.stringify(restored))).toEqual(restored);
  });
  it('供应商停用、删除与模型移除后选择可用项，保留有效选择', () => {
    const second = { ...provider, id: 'second', models: ['custom-image'] };
    expect(normalizeImageSelection({ providerId: provider.id, model: 'gpt-image-1.5' }, [provider, second])).toEqual({ providerId: provider.id, model: 'gpt-image-1.5' });
    expect(normalizeImageSelection({ providerId: provider.id, model: config.model }, [{ ...provider, enabled: false }, second])).toEqual({ providerId: second.id, model: 'custom-image' });
    expect(normalizeImageSelection({ providerId: provider.id, model: 'removed' }, [provider])).toEqual({ providerId: provider.id, model: config.model });
    expect(normalizeImageSelection({ providerId: provider.id, model: config.model }, [])).toEqual({ providerId: '', model: '' });
    expect(() => validateImageProvider({ ...provider, name: ' ' })).toThrow('名称');
    expect(() => validateImageProvider({ ...provider, models: [] })).toThrow('模型');
  });
  it('支持 API 基础地址和完整生成地址，拒绝无效协议和嵌入凭据', () => {
    expect(imageAPIBase({ ...config, baseUrl: 'https://api.openai.com/' })).toBe('https://api.openai.com/v1');
    expect(imageAPIBase({ ...config, baseUrl: 'http://localhost:1422/proxy/v1/images/edits/' })).toBe('http://localhost:1422/proxy/v1');
    for (const baseUrl of ['file:///tmp/image', 'https://secret@api.openai.com/v1', 'https://api.openai.com/v1?token=secret', 'invalid']) expect(() => validateImageConfig({ ...config, baseUrl })).toThrow('地址');
    expect(() => validateImageConfig({ ...config, model: ' ' })).toThrow('设置');
  });
  it('按文件内容识别图片，拒绝非图片、无效编码和过大图片', () => {
    expect(imageDataUrl(imageBytes(source))).toBe(source);
    expect(imageDataUrl(new Uint8Array([255, 216, 255, 0]))).toMatch(/^data:image\/jpeg/);
    expect(imageDataUrl(new TextEncoder().encode('RIFF0000WEBP'))).toMatch(/^data:image\/webp/);
    expect(() => imageDataUrl(new TextEncoder().encode('<html>'))).toThrow('图片');
    expect(() => imageBytes('data:image/png;base64,==bad')).toThrow('无效');
    expect(() => imageDataUrl(new Uint8Array(MAX_COVER_BYTES + 1))).toThrow('10 MB');
  });
  it('只接受能解码的图片，停止时清理图片加载', async () => {
    let instance: { onload: (() => void) | null; onerror: (() => void) | null; src: string; naturalWidth: number; naturalHeight: number };
    vi.stubGlobal('Image', class {
      onload = null; onerror = null; src = ''; naturalWidth = 1; naturalHeight = 1;
      constructor() { instance = this; }
    });
    const failed = expect(validateCoverImage(source)).rejects.toThrow('无法读取');
    instance!.onerror!(); await failed;
    const loaded = validateCoverImage(source); instance!.onload!(); await loaded;
    const controller = new AbortController();
    const stopped = expect(validateCoverImage(source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await stopped;
    expect(instance!.src).toBe(''); expect(instance!.onload).toBeNull();
  });
});

describe('图片供应商模型获取', () => {
  it('从完整图片地址获取模型，使用对应凭据，遍历分页并去重', async () => {
    vi.mocked(http).mockResolvedValueOnce(response({ data: [{ id: 'image-b' }], has_more: true, last_id: 'image-b' })).mockResolvedValueOnce(response({ data: [{ id: 'image-a' }, { id: 'image-b' }] }));
    const signal = new AbortController().signal;
    expect(await getImageModels({ ...provider, baseUrl: config.baseUrl + '/images/generations' }, signal)).toEqual(['image-a', 'image-b']);
    expect(vi.mocked(http).mock.calls[0][0]).toMatchObject({ url: config.baseUrl + '/models', providerId: config.id, keyHeader: 'Authorization', keyPrefix: 'Bearer ', signal });
    expect(vi.mocked(http).mock.calls[1][0].url).toBe(config.baseUrl + '/models?after_id=image-b');
  });
  it('未保存的密钥可获取模型，清除密钥时不使用旧凭据', async () => {
    vi.mocked(http).mockResolvedValue(response({ data: [{ id: 'image-a' }] }));
    await getImageModels(provider, new AbortController().signal, 'new-test-secret');
    expect(vi.mocked(http).mock.calls[0][0]).toMatchObject({ headers: { Authorization: 'Bearer new-test-secret' } });
    expect(vi.mocked(http).mock.calls[0][0].providerId).toBeUndefined();
    await getImageModels(provider, new AbortController().signal, '');
    expect(vi.mocked(http).mock.calls[1][0].providerId).toBeUndefined();
    expect(vi.mocked(http).mock.calls[1][0].headers).toEqual({});
  });
  it('获取失败不重复请求，取消后拒绝迟到的模型列表', async () => {
    vi.mocked(http).mockRejectedValueOnce(new Error('连接失败'));
    await expect(getImageModels(provider, new AbortController().signal)).rejects.toThrow('连接失败');
    expect(http).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    vi.mocked(http).mockImplementationOnce(async () => { controller.abort(); return response({ data: [{ id: 'image-a' }] }); });
    await expect(getImageModels(provider, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('封面生成与对话调整', () => {
  it('提示包含小说信息、此前要求与本次调整，限制输入长度', () => {
    const project = { title: '记忆城市', genre: '科幻悬疑', theme: '记忆与身份', synopsis: '调查员追查失踪案。' };
    const prompt = coverPrompt(project, '保留书名，改为夜景', ['橙色封面']);
    for (const text of Object.values(project).concat(['橙色封面', '保留书名，改为夜景'])) expect(prompt).toContain(text);
    expect(() => coverPrompt(project, ' ', [])).toThrow('要求');
    expect(() => coverPrompt(project, '字'.repeat(4001), [])).toThrow('4000');
  });
  it('首次生成发送 JSON，选择独立图片凭据并保留修订提示', async () => {
    vi.mocked(http).mockResolvedValue(response({ data: [{ b64_json: png, revised_prompt: '修订后的提示' }] }));
    expect(await generateCover(config, '封面', '', new AbortController().signal)).toEqual({ dataUrl: source, prompt: '修订后的提示' });
    const request = vi.mocked(http).mock.calls[0][0];
    expect(request).toMatchObject({ url: 'https://api.openai.com/v1/images/generations', method: 'POST', providerId: 'cover-test', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(request.body!)).toEqual({ model: config.model, prompt: '封面', size: config.size, quality: 'auto', output_format: 'png', n: 1 });
    expect(request.form).toBeUndefined();
  });
  it('调整上传当前版本原图和要求，通过 multipart 发送', async () => {
    vi.mocked(http).mockResolvedValue(result());
    await generateCover(config, '改为夜景', source, new AbortController().signal);
    const request = vi.mocked(http).mock.calls[0][0];
    expect(request).toMatchObject({ url: 'https://api.openai.com/v1/images/edits', providerId: config.id, form: { fields: { prompt: '改为夜景', n: '1' }, files: [{ field: 'image[]', name: 'cover.png', mime: 'image/png', bytes: Array.from(imageBytes(source)) }] } });
    expect(request.headers).toBeUndefined(); expect(request.body).toBeUndefined();
  });
  it('切换供应商与模型后，生成参数使用该供应商和本次尺寸画质', async () => {
    vi.mocked(http).mockResolvedValue(result());
    await generateCover({ ...config, id: 'second', baseUrl: 'https://images.example/v1', model: 'custom-image', size: '1024x1024', quality: 'high' }, '封面', '', new AbortController().signal);
    const request = vi.mocked(http).mock.calls[0][0];
    expect(request).toMatchObject({ providerId: 'second', url: 'https://images.example/v1/images/generations' });
    expect(JSON.parse(request.body!)).toMatchObject({ model: 'custom-image', size: '1024x1024', quality: 'high' });
  });
  it('下载接口返回的图片 URL 时不携带 API 凭据', async () => {
    vi.mocked(http).mockResolvedValueOnce(response({ data: [{ url: 'https://images.example/cover.png' }] })).mockResolvedValueOnce({ text: '', bytes: imageBytes(source), status: 200 });
    expect((await generateCover(config, '封面', '', new AbortController().signal)).dataUrl).toBe(source);
    expect(vi.mocked(http).mock.calls[1][0]).toMatchObject({ url: 'https://images.example/cover.png', binary: true });
    expect(vi.mocked(http).mock.calls[1][0].providerId).toBeUndefined();
  });
  it.each([null, [], {}, { data: [] }, { data: [{ b64_json: 'invalid' }] }, { data: [{ url: 'file:///tmp/image' }] }, { data: [{ url: 'https://key@images.example/a.png' }] }, { error: { message: '额度不足' } }])('拒绝无效结果并保留错误：%j', async payload => {
    vi.mocked(http).mockResolvedValue(response(payload));
    await expect(generateCover(config, '封面', '', new AbortController().signal)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('失败不自动重复图片请求；停止后不接收迟到图片', async () => {
    vi.mocked(http).mockRejectedValueOnce(new Error('连接失败'));
    await expect(generateCover(config, '封面', '', new AbortController().signal)).rejects.toThrow('连接失败');
    expect(http).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(generateCover(config, '封面', '', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(http).toHaveBeenCalledTimes(1);
    const late = new AbortController();
    vi.mocked(http).mockImplementationOnce(async () => { late.abort(); return result(); });
    await expect(generateCover(config, '封面', '', late.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
