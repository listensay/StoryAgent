import { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Button, Modal, ModalPresence, Paper, Textarea, Title } from './components';
import type { TrainingAnnotation } from './domain';

export function TrainingFeedbackList({ annotations, cases, canEdit = false, onEdit, onDelete }: {
  annotations: TrainingAnnotation[]; cases: { title: string }[]; canEdit?: boolean;
  onEdit?: (index: number, feedback: string) => void; onDelete?: (index: number) => void;
}) {
  const [editing, setEditing] = useState<number>();
  const [feedback, setFeedback] = useState('');
  useEffect(() => { if (!canEdit) setEditing(undefined); }, [canEdit]);
  if (!annotations.length) return null;
  return <><Stack gap="sm"><Title order={4}>片段评价 · {annotations.length}</Title>{annotations.map((annotation, index) => {
    const label = `${annotation.target === 'original' ? '原文' : '生成稿'}${cases.length > 1 ? ` · ${cases[annotation.caseIndex]?.title ?? ''}` : ''} · 评价 ${index + 1}`;
    return <Paper key={index} p="md" shadow="none"><Stack gap="sm"><Group justify="space-between"><Text size="sm" fw={500}>{label}</Text>{canEdit && <Group gap="xs"><Button onClick={() => { setEditing(index); setFeedback(annotation.feedback); }}>编辑评价 {index + 1}</Button><Button danger onClick={() => onDelete?.(index)}>删除评价 {index + 1}</Button></Group>}</Group>
      <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{annotation.quote}</Text>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{annotation.feedback}</Text>
    </Stack></Paper>;
  })}</Stack><ModalPresence>{editing !== undefined && canEdit && annotations[editing] && <Modal title={`编辑评价 ${editing + 1}`} onClose={() => setEditing(undefined)} footer={<><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={!feedback.trim()} onClick={() => { onEdit?.(editing, feedback.trim()); setEditing(undefined); }}>保存评价</Button></>}><Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{annotations[editing].quote}</Text><Textarea label="片段评价" data-autofocus value={feedback} maxLength={4000} autosize minRows={3} onChange={event => setFeedback(event.target.value)} /></Modal>}</ModalPresence></>;
}
