import { useState } from 'react';
import { ArticleCollection } from './ArticleCollection';
import { ProviderEditor, protocols } from './ProviderEditor';
import { ImageProviderEditor } from './ImageProviderEditor';
import { type ImageProvider } from '../coverData';
import { Download, Plus, Server, Trash2, Upload } from '../icons';
import { Paper, UnstyledButton, Title, Button, Confirm, EmptyState, IconButton, ModalPresence, Badge, Switch } from '../components';
import { type Provider, type Workspace, DEFAULT_AI_RETRIES, defaultAdvanced, parseWorkspace, uid } from '../domain';
import { exportFile, pickFiles, saveCredential } from '../platform';
import { type Store } from '../useWorkspace';

export function Settings({ store }: { store: Store }) {
  const [provider, setProvider] = useState<Provider>();
  const [remove, setRemove] = useState<Provider>();
  const [backup, setBackup] = useState<Workspace>();
  const [imageEditor, setImageEditor] = useState<ImageProvider>();
  const [removeImage, setRemoveImage] = useState<ImageProvider>();
  const report = (e: unknown) => store.notify(e instanceof Error ? e.message : String(e));
  const editProvider = (p?: Provider) => setProvider(p ? structuredClone(p) : { id: uid(), name: '', protocol: 'chat', baseUrl: '', enabled: true, hasKey: false, models: [], maxRetries: DEFAULT_AI_RETRIES, advanced: defaultAdvanced() });
  const saveProvider = async (value: Provider, apiKey?: string) => {
    if (apiKey !== undefined) await saveCredential(value.id, apiKey);
    store.update(s => { const i = s.providers.findIndex(p => p.id === value.id); if (i < 0) s.providers.push(value); else s.providers[i] = value; });
    setProvider(undefined);
  };
  const restore = async () => { try { const files = await pickFiles(); if (files[0]) setBackup(parseWorkspace(new TextDecoder().decode(files[0].bytes))); } catch (e) { report(e); } };
  const editImageProvider = (p?: ImageProvider) => setImageEditor(p ? structuredClone(p) : { id: uid(), name: '', baseUrl: 'https://api.openai.com/v1', models: [], hasKey: false, enabled: true });
  const saveImageProvider = async (value: ImageProvider, secret?: string) => {
    if (secret !== undefined) await saveCredential(value.id, secret);
    store.update(s => { const index = s.imageProviders.findIndex(p => p.id === value.id); if (index < 0) s.imageProviders.push(value); else s.imageProviders[index] = value; }); setImageEditor(undefined);
  };
  return <div className="page settings-page">
    <Paper component="section" className="surface"><div className="section-heading"><Title order={2}>AI 供应商</Title><Button primary icon={Plus} onClick={() => editProvider()}>添加供应商</Button></div>{!store.state.providers.length && <EmptyState>暂无 AI 供应商</EmptyState>}<div className="settings-list">{store.state.providers.map(p => <article key={p.id} className="settings-row"><span className="item-icon"><Server size={21} /></span><UnstyledButton className="item-main" onClick={() => editProvider(p)}><Title order={3}>{p.name}<Badge>{protocols.find(o => o.value === p.protocol)?.label}</Badge></Title><p>{p.baseUrl}</p><small>{p.models.length} 个模型 · {p.hasKey ? '密钥已设置' : '未设置密钥'}</small></UnstyledButton><Switch aria-label={`启用${p.name}`} checked={p.enabled} onChange={e => store.update(s => { s.providers.find(i => i.id === p.id)!.enabled = e.target.checked; })} /><Button onClick={() => editProvider(p)}>编辑</Button><IconButton icon={Trash2} label={`删除${p.name}`} onClick={() => setRemove(p)} /></article>)}</div></Paper>
    <Paper component="section" className="surface"><div className="section-heading"><Title order={2}>图片供应商</Title><Button primary icon={Plus} onClick={() => editImageProvider()}>添加供应商</Button></div>{!store.state.imageProviders.length && <EmptyState minHeight={100}>暂无图片供应商</EmptyState>}<div className="settings-list">{store.state.imageProviders.map(p => <article key={p.id} className="settings-row"><span className="item-icon"><Server size={21} /></span><UnstyledButton className="item-main" onClick={() => editImageProvider(p)}><Title order={3}>{p.name}<Badge>OpenAI 兼容</Badge></Title><p>{p.baseUrl}</p><small>{p.models.length} 个模型 · {p.hasKey ? '密钥已设置' : '未设置密钥'}</small></UnstyledButton><Switch aria-label={`启用图片供应商${p.name}`} checked={p.enabled} onChange={e => store.update(s => { s.imageProviders.find(value => value.id === p.id)!.enabled = e.target.checked; })} /><Button onClick={() => editImageProvider(p)}>编辑</Button><IconButton icon={Trash2} label={`删除图片供应商${p.name}`} onClick={() => setRemoveImage(p)} /></article>)}</div></Paper>
    <ArticleCollection store={store} />
    <Paper component="section" className="surface"><div className="section-heading"><Title order={2}>数据备份</Title><div className="row"><Button icon={Download} onClick={() => void exportFile(`StoryAgent-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.state, null, 2)).catch(report)}>导出备份</Button><Button icon={Upload} onClick={() => void restore()}>恢复备份</Button></div></div></Paper>
    <ModalPresence>{provider && <ProviderEditor key={provider.id} initial={provider} onSave={saveProvider} onClose={() => setProvider(undefined)} />}</ModalPresence>
    <ModalPresence>{imageEditor && <ImageProviderEditor key={imageEditor.id} initial={imageEditor} onSave={saveImageProvider} onClose={() => setImageEditor(undefined)} />}</ModalPresence>
    <ModalPresence>{removeImage && <Confirm title="删除图片供应商" content={`确认删除「${removeImage.name}」？`} onClose={() => setRemoveImage(undefined)} onConfirm={() => void saveCredential(removeImage.id, '').then(() => store.update(s => { s.imageProviders = s.imageProviders.filter(p => p.id !== removeImage.id); })).catch(report)} />}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除供应商" content={`确认删除「${remove.name}」？`} onClose={() => setRemove(undefined)} onConfirm={() => void saveCredential(remove.id, '').then(() => store.update(s => { s.providers = s.providers.filter(p => p.id !== remove.id); })).catch(report)} />}</ModalPresence>
    <ModalPresence>{backup && <Confirm title="恢复备份" content={`将替换当前数据为备份中的 ${backup.projects.length} 部小说。`} onClose={() => setBackup(undefined)} onConfirm={() => void store.replace(backup).catch(report)} />}</ModalPresence>
  </div>;
}
