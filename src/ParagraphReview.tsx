import { useMemo, useState } from 'react';
import { Box, Checkbox, Group, ScrollArea, Stack, Text, Textarea } from '@mantine/core';
import { Button, Diff, EmptyState, Modal, OptionTabs, type ModalVisibilityProps } from './components';
import type { Chapter, Job, JobStep } from './domain';
import type { Store } from './useWorkspace';
import { adoptPassages, mergedManuscript, passageChanges, previousChoices, type Choices } from './paragraphAdoption';

export function ParagraphReview({ job, step, chapter, store, onClose, ...visibility }: {
  job: Job; step: JobStep; chapter: Chapter; store: Store; onClose: () => void;
} & ModalVisibilityProps) {
  // Freeze the proposal being reviewed; the live chapter is checked again in the mutation.
  const [source] = useState(() => ({ job, step, plan: job.steps.find(s => s.chapterId === chapter.id && s.stage === 'plan')?.output }));
  const rows = useMemo(() => passageChanges(source.job, source.step), [source]);
  const previous = useMemo(() => previousChoices(source.step), [source]);
  const differences = useMemo(() => rows.flatMap((row, i) => row.changed && !previous.has(i) ? [i] : []), [rows, previous]);
  const [checked, setChecked] = useState(new Set<number>());
  const [edits, setEdits] = useState(new Map<number, string>());
  const [includePlan, setIncludePlan] = useState(false), [tab, setTab] = useState('changes');
  const choices: Choices = new Map([...checked].map(i => [i, edits.get(i)]));
  const manuscript = mergedManuscript(source.job, source.step, rows, new Map([...previous, ...choices]));
  const stale = chapter.content !== (source.step.paragraphAdoption?.content ?? source.step.baseContent) || (includePlan && chapter.plan !== source.step.basePlan);
  const invalid = [...choices.values()].some(edit => edit !== undefined && !edit.trim());
  const select = (i: number, on: boolean) => setChecked(previous => { const next = new Set(previous); if (on) next.add(i); else next.delete(i); return next; });
  const save = () => {
    try {
      store.update(state => adoptPassages(state, source.job, source.step, choices, includePlan, source.plan));
      onClose();
      void store.saveChapter(job.projectId, chapter.id);
    } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <Modal title="逐段采用" bounded onClose={onClose} {...visibility} footer={<>
    <Text size="sm" c={stale || invalid ? 'red.8' : 'dimmed'} mr="auto" role="status">{stale ? '正文或细纲已更新，请重新生成或手动合并' : invalid ? '候选段落不能为空' : `已选 ${checked.size} / ${differences.length} 处`}</Text>
    <Button onClick={onClose}>取消</Button><Button primary disabled={stale || invalid || !checked.size || manuscript === chapter.content || store.polishingChapters.includes(chapter.id)} onClick={save}>采用所选修改</Button>
  </>}>
    <Group justify="space-between" gap="sm"><OptionTabs value={tab} label="采用对照" onChange={setTab} options={[{ value: 'changes', label: '段落修改' }, { value: 'preview', label: '正文预览' }]} />
      {tab === 'changes' && !!differences.length && <Button onClick={() => setChecked(checked.size === differences.length ? new Set() : new Set(differences))}>{checked.size === differences.length ? '取消全选' : '全选修改'}</Button>}
    </Group>
    {source.plan && !job.steps.some(s => s.chapterId === chapter.id && s.stage === 'plan' && s.status === 'accepted') && <Checkbox label="同时采用生成细纲" checked={includePlan} onChange={e => setIncludePlan(e.currentTarget.checked)} disabled={!includePlan && chapter.plan !== source.step.basePlan} />}
    {tab === 'preview' ? <Diff left={chapter.content} right={manuscript} rightTitle="采用后正文" highlightChanges onError={store.notify} /> : !differences.length ? <EmptyState>生成稿与原文相同</EmptyState> :
      <ScrollArea type="auto" offsetScrollbars style={{ flex: 1, minHeight: 0 }} viewportProps={{ role: 'region', 'aria-label': '段落修改', tabIndex: 0 }}>
        <Stack gap="md">{differences.map(i => {
          const { before, after } = rows[i];
          const label = before && after ? `替换原文第 ${before.index + 1} 段` : before ? `删除原文第 ${before.index + 1} 段` : `新增第 ${after!.index + 1} 段`;
          return <Box key={i} className="passage-change" data-chosen={checked.has(i) || undefined}>
            <Checkbox label={label} checked={checked.has(i)} onChange={e => select(i, e.currentTarget.checked)} />
            <div className="passage-pair">{before && <Stack gap={4}><Text size="xs" fw={600} c="dimmed">原文</Text><Text className="prose" size="sm">{before.body}</Text></Stack>}
              {after && <Stack gap={4}><Group justify="space-between" gap="xs"><Text size="xs" fw={600} c="dimmed">生成稿</Text>{!edits.has(i) && <Button onClick={() => { setEdits(previous => new Map(previous).set(i, after.body)); select(i, true); }}>编辑段落</Button>}</Group>
                {edits.has(i) ? <Textarea aria-label={`编辑生成稿第 ${after.index + 1} 段`} autosize minRows={2} maxRows={12} value={edits.get(i)} onChange={event => { const text = event.currentTarget.value; setEdits(previous => new Map(previous).set(i, text)); }} /> : <Text className="prose" size="sm">{after.body}</Text>}
              </Stack>}</div>
          </Box>;
        })}</Stack>
      </ScrollArea>}
  </Modal>;
}
