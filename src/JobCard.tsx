import { memo, useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, GitCompare, Pause, Play, RefreshCw, Settings2, Trash2 } from './icons';
import { type Job, type JobStep, taskNames } from './domain';
import { type Store } from './useWorkspace';
import { Paper, UnstyledButton, Title, Button, Diff, EmptyState, IconButton, ModalPresence, Modal, Badge, type ModalVisibilityProps } from './components';
import { AIControls } from './AIControls';
import { Markdown } from './Markdown';
const statuses = { queued: '排队中', waiting: '待评分', running: '进行中', paused: '已停止', failed: '失败', ready: '待确认', accepted: '已完成' };

export function JobCard({ job, store, compact = false, focused = false }: { job: Job; store: Store; compact?: boolean; focused?: boolean }) {
  const [open, setOpen] = useState(focused || job.status !== 'accepted');
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    const id = requestAnimationFrame(() => document.getElementById(`job-${job.id}`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [focused, job.id]);
  const [compareId, setCompare] = useState<string>();
  const compare = job.steps.find(step => step.id === compareId);
  const [citation, setCitation] = useState<number>();
  const [source, setSource] = useState('');
  const showCitation = useCallback((text: string, number: number) => { setSource(text); setCitation(number); }, []);
  const [aiOpen, setAIOpen] = useState(false);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); store.notify('已复制'); } catch { store.notify('复制失败'); } };
  const result = (step: JobStep) => {
    const sourceText = job.sourceText || step.baseContent || job.steps.find(s => !s.intermediate && s.chapterId === step.chapterId)?.baseContent || '';
    return <JobResult output={step.output} sourceText={sourceText} onError={store.notify} onCitation={showCitation} />;
  };
  const proposed = (step: JobStep) => job.kind === 'continue' ? step.baseContent + '\n\n' + step.output : job.kind === 'rewrite' && step.selection ? step.baseContent.slice(0, step.selectionStart) + step.output + step.baseContent.slice(step.selectionEnd) : step.output;
  const canAccept = (step: JobStep) => step.status === 'ready' && !step.intermediate && (!step.stage || job.steps.filter(s => s.chapterId === step.chapterId).every(s => ['ready', 'accepted'].includes(s.status)));
  return <Paper id={`job-${job.id}`} component="article" p="md"  className={`job-card ${compact ? 'compact' : ''}`}>
    <div className="job-heading"><UnstyledButton className="job-title" onClick={() => setOpen(!open)} aria-expanded={open}><span>{taskNames[job.kind]}</span>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</UnstyledButton><Badge color={job.status === 'running' ? 'story' : 'gray'}>{statuses[job.status]}</Badge></div>
    {open && <><div className="job-meta">{job.collectionTask || job.articleTask ? '正文采集' : job.ai ? `${store.state.providers.find(p => p.id === job.ai?.providerId)?.name ?? '供应商已移除'} · ${job.ai.model}` : 'AI 未设置'} · {new Date(job.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      {job.steps.map(step => <section className="job-step" key={step.id}><div className="row between"><Title order={4}>{step.title}</Title>{step.status === 'accepted' && <Check size={16} />}</div>{step.output ? result(step) : <EmptyState minHeight={88}>{job.collectionTask || job.articleTask ? job.status === 'running' ? '正在采集…' : '等待采集' : step.status === 'running' ? '正在生成…' : '等待生成'}</EmptyState>}
        {step.output && <div className="row actions"><IconButton icon={Copy} label="复制结果" onClick={() => void copy(step.output)} />{['draft', 'continue', 'rewrite', 'plan'].includes(job.kind) && <Button icon={GitCompare} onClick={() => setCompare(step.id)}>对比</Button>}{canAccept(step) && <Button primary icon={Check} onClick={() => store.accept(job.id, step.id)}>{['review', 'scan', 'analyze'].includes(job.kind) ? '保存参考' : job.kind === 'style' ? '保存 Skill' : '采用'}</Button>}</div>}
      </section>)}
      {job.error && <p className="error" role="alert">{job.error}</p>}
      <div className="row actions job-controls">{['running', 'queued'].includes(job.status) ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>{['paused', 'failed'].includes(job.status) && <>{job.ai && <Button icon={Settings2} onClick={() => setAIOpen(true)}>AI 设置</Button>}<Button icon={Play} onClick={() => store.resumeJob(job.id)}>继续</Button><Button icon={RefreshCw} onClick={() => store.resumeJob(job.id, true)}>重新生成</Button></>}<IconButton icon={Trash2} label="删除任务" onClick={() => store.update(s => { s.jobs = s.jobs.filter(j => j.id !== job.id); })} /></>}</div>
    </>}
    <ModalPresence>{compare && <Modal title={`${compare.title} · 对比`} wide onClose={() => setCompare(undefined)} footer={<><Button onClick={() => setCompare(undefined)}>关闭</Button>{canAccept(compare) && <Button primary onClick={() => { store.accept(job.id, compare.id); setCompare(undefined); }}>采用</Button>}</>}><Diff left={job.kind === 'plan' ? compare.basePlan : store.state.projects.find(p => p.id === job.projectId)?.chapters.find(c => c.id === compare.chapterId)?.content ?? compare.baseContent} right={proposed(compare)} leftTitle={job.kind === 'plan' ? '原大纲' : '当前正文'} /></Modal>}</ModalPresence>
    <ModalPresence>{citation !== undefined && <SourceModal text={source} number={citation} onClose={() => setCitation(undefined)} />}</ModalPresence>
    <ModalPresence>{aiOpen && <JobAIEditor store={store} onClose={() => setAIOpen(false)} />}</ModalPresence>
  </Paper>;
}
const JobResult = memo(function JobResult({ output, sourceText, onError, onCitation }: { output: string; sourceText: string; onError: (message: string) => void; onCitation: (text: string, number: number) => void }) {
  const cite = useCallback((number: number) => onCitation(sourceText, number), [sourceText, onCitation]);
  return <Markdown className="result" onError={onError} onCitation={sourceText ? cite : undefined}>{output}</Markdown>;
});
function JobAIEditor({ store, onClose, ...visibility }: { store: Store; onClose: () => void } & ModalVisibilityProps) {
  return <Modal title="AI 设置" onClose={onClose} {...visibility} footer={<Button primary onClick={onClose}>完成</Button>}><AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} /></Modal>;
}
function SourceModal({ text, number, onClose, ...visibility }: { text: string; number: number; onClose: () => void } & ModalVisibilityProps) {
  const paragraphs = text.split(/\n\s*\n|\n/).filter(s => s.trim());
  return <Modal title="原文位置" wide onClose={onClose} {...visibility} onEnterTransitionEnd={() => document.getElementById(`source-p-${number}`)?.scrollIntoView({ block: 'center' })}><div className="source-paragraphs">{paragraphs.map((p, i) => <p id={`source-p-${i + 1}`} className={number === i + 1 ? 'highlight' : ''} key={i}><span className="muted">[P{i + 1}]</span> {p}</p>)}</div>{number > paragraphs.length && <p className="error">原文中没有该段落</p>}</Modal>;
}
