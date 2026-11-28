import { Group, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { Plus, FileUp, FolderOpen, Github, History, RefreshCw, Trash2 } from '../icons';
import { Paper, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, EmptyState, Field, IconButton, ModalPresence, Modal, Badge, Checkbox, Fieldset, Switch, Select } from '../components';
import { type Skill, type TaskKind, taskNames } from '../domain';
import { archiveSkill, sameEdition } from '../skillVersions';
import { expandFiles, githubSkills, mergeSkills, parseSkills } from '../skills';
import { pickFiles } from '../platform';
import { type Store } from '../useWorkspace';
import { CreateSkill } from '../CreateSkill';
import { manualSource, manualEntry, validateManualSkill, editableFiles, skillSourceLabel } from '../manualSkill';
import { Markdown } from '../Markdown';

export function Skills({ store }: { store: Store }) {
  const [editing, setEditing] = useState<Skill>(), [remove, setRemove] = useState<Skill>();
  const [path, setPath] = useState('SKILL.md');
  const [github, setGithub] = useState(false), [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(false);
  const report = (e: unknown) => store.notify(e instanceof Error ? e.message : String(e));
  const imported = (skills: Skill[]) => {
    store.update(s => {
      for (const incoming of skills) {
        const match = (skill: Skill) => !skill.builtin && skill.name === incoming.name && skill.source === incoming.source;
        if (!sameEdition(store.state.skills.find(match), s.skills.find(match))) throw new Error('导入期间 Skill 已变更，请重新导入');
      }
      s.skills = mergeSkills(s.skills, skills);
    });
    store.notify(`已导入 ${skills.length} 个 Skill`);
  };
  const importFiles = async (folder = false) => { if (busy) return; setBusy(true); try { const files = await pickFiles({ folder, skills: true }); if (files.length) imported(parseSkills(expandFiles(files), '文件导入')); } catch (e) { report(e); } finally { setBusy(false); } };
  const fromGithub = async (source = url) => { if (busy) return; setBusy(true); try { imported(await githubSkills(source)); setGithub(false); } catch (e) { report(e); } finally { setBusy(false); } };
  const [editBase, setEditBase] = useState<Skill>();
  const openSkill = (skill: Skill) => { setEditBase(skill); setEditing({ ...structuredClone(skill), files: editableFiles(skill) }); setPath(skill.files[0]?.path ?? 'SKILL.md'); setHistory(false); };
  const save = () => {
    if (!editing || editing.id === 'builtin-revise') return;
    if (!editing.name.trim()) { report('请填写名称'); return; }
    try {
      store.update(s => {
        const i = s.skills.findIndex(k => k.id === editing.id), old = s.skills[i];
        if (!old || !sameEdition(old, editBase)) throw new Error('Skill 已变更，请重新打开编辑');
        let files = editing.files;
        if (old.source === manualSource) {
          const entry = files.find(f => f.path === 'SKILL.md');
          if (!entry) throw new Error('缺少 Skill 规则文件');
          const draft = { ...editing, rules: entry.content };
          const error = validateManualSkill(draft, s.skills, old.id);
          if (error) throw new Error(error);
          files = files.map(f => f === entry ? { ...f, content: manualEntry(draft) } : f);
        }
        s.skills[i] = { ...old, name: editing.name.trim(), description: editing.description, tasks: editing.tasks, files, version: editing.version, revisions: archiveSkill(old) };
      });
      setEditing(undefined);
    } catch (error) { report(error); }
  };
  return <div className="page"><div className="section-heading"><div><Title order={2}>技能管理</Title><p className="muted">{store.state.skills.filter(s => s.enabled).length} 个已启用</p></div><div className="row"><Button icon={Github} disabled={busy} onClick={() => setGithub(true)}>GitHub 导入</Button><Button icon={FolderOpen} disabled={busy} onClick={() => void importFiles(true)}>选择文件夹</Button><Button icon={FileUp} disabled={busy} onClick={() => void importFiles()}>导入文件</Button><Button primary icon={Plus} onClick={() => setCreating(true)}>新建 Skill</Button></div></div>{!store.state.skills.length ? <EmptyState>暂无 Skill</EmptyState> : <Paper p={0} style={{ overflow: 'hidden' }}><Table.ScrollContainer minWidth={820}><Table verticalSpacing="md" horizontalSpacing="lg" highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th w="36%">Skill</Table.Th><Table.Th w="24%">适用任务</Table.Th><Table.Th>来源与版本</Table.Th><Table.Th>启用</Table.Th><Table.Th ta="right">操作</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{store.state.skills.map(skill => <Table.Tr key={skill.id}>
        <Table.Td><UnstyledButton w="100%" onClick={() => openSkill(skill)}><Stack gap={4}><Text fw={600} size="sm">{skill.name}</Text><Text c="dimmed" size="sm" style={{ overflowWrap: 'anywhere' }}>{skill.description}</Text></Stack></UnstyledButton></Table.Td>
        <Table.Td><Group gap={6}>{skill.tasks.map(t => <Badge key={t}>{taskNames[t]}</Badge>)}</Group></Table.Td>
        <Table.Td><Stack gap={4}><Text size="sm">{skillSourceLabel(skill)}</Text><Text size="xs" c="dimmed" title={skill.version}>{skill.version.slice(0, 20)} · {skill.files.length} 个文件</Text></Stack></Table.Td>
        <Table.Td><Switch aria-label={`启用${skill.name}`} disabled={skill.id === 'builtin-revise'} checked={skill.enabled} onChange={e => store.update(s => { s.skills.find(k => k.id === skill.id)!.enabled = e.target.checked; })} /></Table.Td>
        <Table.Td><Group gap={4} justify="flex-end" wrap="nowrap">{skill.source.startsWith('https://github.com/') && <IconButton icon={RefreshCw} label={`更新${skill.name}`} disabled={busy} onClick={() => void fromGithub(skill.source.split('#')[0])} />}<Button onClick={() => openSkill(skill)}>{skill.id === 'builtin-revise' ? '查看' : '编辑'}</Button>{!skill.builtin && <IconButton icon={Trash2} label={`删除${skill.name}`} onClick={() => setRemove(skill)} />}</Group></Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer></Paper>}
    <ModalPresence>{creating && <CreateSkill store={store} onClose={() => setCreating(false)} />}</ModalPresence>
    <ModalPresence>{github && <Modal title="GitHub 导入" onClose={() => { if (!busy) setGithub(false); }} footer={<><Button disabled={busy} onClick={() => setGithub(false)}>取消</Button><Button primary disabled={busy || !url.trim()} onClick={() => void fromGithub()}>{busy ? '导入中…' : '导入'}</Button></>}><Field label="仓库或子目录地址"><TextInput data-autofocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/owner/repository" /></Field></Modal>}</ModalPresence>
    <ModalPresence>{editing?.id === 'builtin-revise' && <Modal title="小说 AI Skill" wide onClose={() => setEditing(undefined)}><Markdown onError={store.notify}>{(editing.files[0]?.content ?? '').replace(/^\uFEFF?---\s*\n[\s\S]*?\n---(?:\s*\n|$)/, '')}</Markdown></Modal>}</ModalPresence>
    <ModalPresence>{editing && editing.id !== 'builtin-revise' && <Modal title="编辑 Skill" wide onClose={() => setEditing(undefined)} footer={<><Button icon={History} onClick={() => setHistory(!history)}>历史版本</Button><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary onClick={save}>保存</Button></>}><div className="form-stack"><div className="form-grid"><Field label="名称"><TextInput value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="版本"><TextInput value={editing.version} onChange={e => setEditing({ ...editing, version: e.target.value })} /></Field></div><Field label="描述"><Textarea rows={2} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></Field><Fieldset legend="适用任务"><div className="check-grid">{Object.entries(taskNames).map(([t, label]) => <Checkbox checked={editing.tasks.includes(t as TaskKind)} onChange={e => setEditing({ ...editing, tasks: e.target.checked ? [...editing.tasks, t as TaskKind] : editing.tasks.filter(k => k !== t) })} label={label} key={t} />)}</div></Fieldset><Select label="资源文件" value={path} onChange={setPath} options={editing.files.map(f => ({ value: f.path, label: editing.resourceMode === 'relevant' && f.path !== 'SKILL.md' ? `${f.content.match(/^##[ \t]+(.+)$/m)?.[1] ?? f.content.match(/^#[ \t]+(.+)$/m)?.[1] ?? f.path} · ${f.path}` : f.path }))} /><Textarea className="code" label={editing.source === manualSource && path === 'SKILL.md' ? '写作规则' : undefined} aria-label={editing.source === manualSource && path === 'SKILL.md' ? '写作规则' : 'Skill 文件内容'} rows={14} value={editing.files.find(f => f.path === path)?.content ?? ''} onChange={e => setEditing({ ...editing, files: editing.files.map(f => f.path === path ? { ...f, content: e.target.value } : f) })} />{history && <section><Title order={3}>历史版本</Title>{editing.revisions.length ? editing.revisions.map((r, i) => <div className="settings-row" key={i}><span className="item-main">{r.version}<small>{new Date(r.savedAt).toLocaleString('zh-CN')}</small></span><Button onClick={() => { setEditing({ ...editing, version: r.version, files: editableFiles(editing, r.files) }); setPath(r.files[0]?.path ?? 'SKILL.md'); }}>恢复</Button></div>) : <EmptyState>暂无历史版本</EmptyState>}</section>}</div></Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除 Skill" content={`确认删除「${remove.name}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.skills = s.skills.filter(k => k.id !== remove.id); })} />}</ModalPresence>
  </div>;
}
