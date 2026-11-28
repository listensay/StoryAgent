import { z } from 'zod';

export const memoryKinds = ['fact', 'state', 'timeline', 'foreshadow', 'knowledge'] as const;
const kind = z.enum(memoryKinds);
const phase = z.enum(['plant', 'payoff']);
const linkKind = z.enum(['continuity', 'payoff', 'question']);

// These records outlive the disposable chapter notes used by the writing context.
export const memorySourceSchema = z.object({
  id: z.string(), chapterId: z.string(), kind, title: z.string(), body: z.string(),
  origin: z.enum(['extraction', 'passage', 'author', 'legacy']), subject: z.string().optional(), phase: phase.optional(),
  hash: z.string().optional(), evidence: z.object({ quote: z.string(), start: z.number().int().nonnegative() }).optional(),
  retired: z.boolean().optional(),
});
export const memoryLinkSchema = z.object({
  id: z.string(), fromId: z.string(), toId: z.string(), kind: linkKind,
  reason: z.string(), origin: z.enum(['extraction', 'author']), historical: z.boolean().optional(),
  review: z.object({ result: z.enum(['conflict', 'consistent']), fromHash: z.string(), toHash: z.string() }).optional(),
});
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemoryLink = z.infer<typeof memoryLinkSchema>;

// Additional fields are optional so completed jobs from earlier versions can still be opened or adopted.
export const memoryResultSchema = z.object({
  summary: z.string().default(''), notes: z.array(z.object({
    kind, title: z.string(), body: z.string(), quote: z.string().optional(),
    subject: z.string().optional(), phase: phase.optional(),
    links: z.array(z.object({ sourceId: z.string(), priorQuote: z.string().optional(), kind: linkKind, reason: z.string() })).optional(),
  })),
});
export type MemoryResult = z.infer<typeof memoryResultSchema>;

export function contentHash(text: string) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
