import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, GitCompare, Pause, Play, RefreshCw, Trash2 } from './icons';
import { type Job, type JobStep, taskNames } from './domain';
import { type Store } from './useWorkspace';
import { Paper, UnstyledButton, Title, Button, Diff, EmptyState, IconButton, ModalPresence, Modal, Badge, type ModalVisibilityProps } from './components';
const statuses = { running: '生成中', paused: '已停止', failed: '生成失败', ready: '待确认', accepted: '已采用' };

export function JobCard({ job, store, compact = false }: { job: Job; store: Store; compact?: boolean }) {
  const [open, setOpen] = useState(job.status !== 'accepted');
  const [compareId, setCompare] = useState<string>();
  const compare = job.steps.find(step => step.id === compareId);
  const [citation, setCitation] = useState<number>();
  const [source, setSource] = useState('');
  const retry = () => { store.update(s => { const j = s.jobs.find(j => j.id === job.id); j?.steps.forEach(step => { if (step.status === 'pending') step.output = ''; }); }); void store.runJob(job.id); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); store.notify('已复制'); } catch { store.notify('复制失败'); } };
  const result = (step: JobStep) => {
    const sourceText = job.sourceText || step.baseContent || job.steps.find(s => !s.intermediate && s.chapterId === step.chapterId)?.baseContent || '';
    if (!sourceText || !/\[P\d+\]/.test(step.output)) return <pre className="prose result">{step.output}</pre>;
    return <pre className="prose result">{step.output.split(/(\[P\d+\])/g).map((part, index) => /^\[P\d+\]$/.test(part) ? <UnstyledButton aria-label={`查看原文第 ${part.slice(2, -1)} 段`} c="story.9" bg="story.1" px={4} style={{ display: 'inline', borderRadius: 4 }} key={index} onClick={() => { setSource(sourceText); setCitation(Number(part.slice(2, -1))); }}>{part}</UnstyledButton> : part)}</pre>;
  };
  const proposed = (step: JobStep) => job.kind === 'continue' ? step.baseContent + '\n\n' + step.output : job.kind === 'rewrite' && step.selection ? step.baseContent.slice(0, step.selectionStart) + step.output + step.baseContent.slice(step.selectionEnd) : step.output;
  return <Paper component="article" p="md"  className={`job-card ${compact ? 'compact' : ''}`}>
    <div className="job-heading"><UnstyledButton className="job-title" onClick={() => setOpen(!open)} aria-expanded={open}><span>{taskNames[job.kind]}</span>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</UnstyledButton><Badge color={job.status === 'running' ? 'story' : 'gray'}>{statuses[job.status]}</Badge></div>
    {open && <><div className="job-meta">{store.state.profiles.find(p => p.id === job.profileId)?.name ?? '已移除的预设'} · {new Date(job.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      {job.steps.map(step => <section className="job-step" key={step.id}><div className="row between"><Title order={4}>{step.title}</Title>{step.status === 'accepted' && <Check size={16} />}</div>{step.output ? result(step) : <EmptyState minHeight={88}>{step.status === 'running' ? '正在生成…' : '等待生成'}</EmptyState>}
        {step.output && <div className="row actions"><IconButton icon={Copy} label="复制结果" onClick={() => void copy(step.output)} />{['draft', 'continue', 'rewrite', 'plan'].includes(job.kind) && <Button icon={GitCompare} onClick={() => setCompare(step.id)}>对比</Button>}{step.status === 'ready' && !step.intermediate && <Button primary icon={Check} onClick={() => store.accept(job.id, step.id)}>{['review', 'scan', 'analyze'].includes(job.kind) ? '保存参考' : job.kind === 'style' ? '保存风格' : '采用'}</Button>}</div>}
      </section>)}
      {job.error && <p className="error" role="alert">{job.error}</p>}
      <div className="row actions job-controls">{job.status === 'running' ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>{['paused', 'failed'].includes(job.status) && <><Button icon={Play} onClick={() => void store.runJob(job.id)}>继续</Button><Button icon={RefreshCw} onClick={retry}>重新生成</Button></>}<IconButton icon={Trash2} label="删除任务" onClick={() => store.update(s => { s.jobs = s.jobs.filter(j => j.id !== job.id); })} /></>}</div>
    </>}
    <ModalPresence>{compare && <Modal title={`${compare.title} · 对比`} wide onClose={() => setCompare(undefined)} footer={<><Button onClick={() => setCompare(undefined)}>关闭</Button>{compare.status === 'ready' && !compare.intermediate && <Button primary onClick={() => { store.accept(job.id, compare.id); setCompare(undefined); }}>采用</Button>}</>}><Diff left={job.kind === 'plan' ? compare.basePlan : store.state.projects.find(p => p.id === job.projectId)?.chapters.find(c => c.id === compare.chapterId)?.content ?? compare.baseContent} right={proposed(compare)} leftTitle={job.kind === 'plan' ? '原大纲' : '当前正文'} /></Modal>}</ModalPresence>
    <ModalPresence>{citation !== undefined && <SourceModal text={source} number={citation} onClose={() => setCitation(undefined)} />}</ModalPresence>
  </Paper>;
}
function SourceModal({ text, number, onClose, ...visibility }: { text: string; number: number; onClose: () => void } & ModalVisibilityProps) {
  const paragraphs = text.split(/\n\s*\n|\n/).filter(s => s.trim());
  return <Modal title="原文位置" wide onClose={onClose} {...visibility} onEnterTransitionEnd={() => document.getElementById(`source-p-${number}`)?.scrollIntoView({ block: 'center' })}><div className="source-paragraphs">{paragraphs.map((p, i) => <p id={`source-p-${i + 1}`} className={number === i + 1 ? 'highlight' : ''} key={i}><span className="muted">[P{i + 1}]</span> {p}</p>)}</div>{number > paragraphs.length && <p className="error">原文中没有该段落</p>}</Modal>;
}
