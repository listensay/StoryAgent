import { useState } from 'react';
import { Feather, Plus, Sparkles, Trash2 } from '../icons';
import { type Style, now, uid } from '../domain';
import { Paper, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, Empty, Field, IconButton, ModalPresence, Modal } from '../components';
import { type Store } from '../useWorkspace';

export function Styles({ store, onResearch }: { store: Store; onResearch: () => void }) {
  const [editing, setEditing] = useState<Style>(), [remove, setRemove] = useState<Style>();
  const add = () => setEditing({ id: uid(), name: '', content: '', source: '', createdAt: now() });
  const save = () => { if (!editing?.name.trim() || !editing.content.trim()) return; store.update(s => { const i = s.styles.findIndex(k => k.id === editing.id); if (i < 0) s.styles.unshift(editing); else s.styles[i] = editing; }); setEditing(undefined); };
  return <div className="page"><div className="section-heading"><Title order={2}>写作风格</Title><div className="row"><Button icon={Sparkles} onClick={onResearch}>从文本提取</Button><Button primary icon={Plus} onClick={add}>新建风格</Button></div></div>{!store.state.styles.length ? <Empty icon={Feather} title="暂无写作风格" action="新建风格" onAction={add} /> : <div className="note-grid">{store.state.styles.map(style => <Paper component="article"  className="surface style-card" key={style.id}><UnstyledButton className="item-main" onClick={() => setEditing({ ...style })}><Title order={3}>{style.name}</Title><pre className="prose">{style.content}</pre></UnstyledButton><div className="row between"><small className="muted">{style.source || '自定义'}</small><div className="row"><Button onClick={() => setEditing({ ...style })}>编辑</Button><IconButton icon={Trash2} label={`删除${style.name}`} onClick={() => setRemove(style)} /></div></div></Paper>)}</div>}
    <ModalPresence>{editing && <Modal title="写作风格" wide onClose={() => setEditing(undefined)} footer={<><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={!editing.name.trim() || !editing.content.trim()} onClick={save}>保存</Button></>}><div className="form-stack"><Field label="名称"><TextInput data-autofocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="来源"><TextInput value={editing.source} onChange={e => setEditing({ ...editing, source: e.target.value })} /></Field><Field label="风格规则"><Textarea rows={15} value={editing.content} placeholder="视角、句法、词汇、节奏与表达约束" onChange={e => setEditing({ ...editing, content: e.target.value })} /></Field></div></Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除风格" content={`确认删除「${remove.name}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.styles = s.styles.filter(k => k.id !== remove.id); s.projects.forEach(p => { if (p.styleId === remove.id) p.styleId = ''; p.chapters.forEach(c => { if (c.styleId === remove.id) c.styleId = ''; }); }); })} />}</ModalPresence>
  </div>;
}
