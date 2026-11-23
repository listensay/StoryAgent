import { z } from 'zod';

const text = z.string().trim().min(1);
export const creationStageSchema = z.enum(['genre', 'core', 'outline']);
export const creationStageNames = { genre: '题材', core: '核心设定', outline: '总纲' } as const;
export type CreationStage = z.infer<typeof creationStageSchema>;

export const genreOptionSchema = z.object({ stage: z.literal('genre'), title: text, genre: text, premise: text });
export const coreOptionSchema = z.object({
  stage: z.literal('core'), title: text, theme: text, audience: text,
  form: z.enum(['long', 'short']), targetWords: z.number().int().positive(), synopsis: text, setting: text,
});
export const outlineOptionSchema = z.object({
  stage: z.literal('outline'), title: text, summary: text, outline: text,
  characters: z.array(z.object({ name: text, role: text, motivation: text, arc: text, relations: text, body: text.optional() })).min(1),
  relationships: z.array(z.object({ source: text, target: text, title: text, body: text })).optional(),
  volumes: z.array(z.object({ title: text, summary: text, turningPoints: text, ending: text })).min(1),
});
export const creationOptionSchema = z.discriminatedUnion('stage', [
  genreOptionSchema.extend({ id: text }), coreOptionSchema.extend({ id: text }), outlineOptionSchema.extend({ id: text }),
]);
export const creationDraftSchema = z.object({
  id: text, idea: text, genre: text.max(200).optional(), stage: creationStageSchema,
  selections: z.object({ genre: z.string(), core: z.string(), outline: z.string() }),
  rounds: z.array(z.object({ id: text, stage: creationStageSchema, contextKey: z.string(), instruction: text, options: z.array(creationOptionSchema) })),
  createdAt: text,
});
export const creationTaskSchema = z.object({ draftId: text, roundId: text, stage: creationStageSchema });
export type CreationOption = z.infer<typeof creationOptionSchema>;
export type CreationDraft = z.infer<typeof creationDraftSchema>;
