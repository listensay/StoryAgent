import { z } from 'zod';

export const mechanismCategories = {
  voice: '叙述口吻', dialogue: '对白与潜台词', rhythm: '句法与节奏',
  emotion: '情绪与阅读回报', scene: '场景组织', plot: '情节推进',
} as const;

const sentence = z.string().trim().min(1);
export const skillResearchSchema = z.object({
  profile: sentence,
  mechanisms: z.array(z.object({
    title: sentence,
    category: z.enum(Object.keys(mechanismCategories) as [keyof typeof mechanismCategories, ...Array<keyof typeof mechanismCategories>]),
    trigger: sentence,
    steps: z.array(sentence).min(1),
    effect: sentence,
    example: sentence,
    avoid: sentence,
    check: sentence,
    evidence: z.array(z.object({ start: z.number().int().positive(), end: z.number().int().positive().optional(), quote: sentence.min(2).optional() })).min(1),
  })).min(1),
});
export type SkillResearch = z.infer<typeof skillResearchSchema>;
export type WritingMechanism = SkillResearch['mechanisms'][number];

const compositionEvidence = z.preprocess(value => Array.isArray(value) ? value.flatMap(item => {
  if (typeof item !== 'string') return [item];
  const match = item.trim().replace(/^\[([^\]]+)\]$/, '$1').match(/^P?([1-9]\d*)(?:\s*[-–—]\s*P?([1-9]\d*))?$/i);
  if (!match || (match[2] && Number(match[2]) < Number(match[1]))) return [item];
  return match[2] ? [Number(match[1]), Number(match[2])] : [Number(match[1])];
}) : value, z.array(z.number().int().positive()).min(1).transform(value => [...new Set(value)]));

export const skillCompositionSchema = z.object({
  name: sentence,
  description: sentence,
  profile: sentence,
  expression: z.array(z.object({
    title: sentence, guideline: sentence, example: sentence, boundary: sentence,
    evidence: compositionEvidence,
  })).min(1),
});
export type SkillComposition = z.infer<typeof skillCompositionSchema>;

export const skillRevisionSchema = skillCompositionSchema.extend({
  expression: z.array(skillCompositionSchema.shape.expression.element.omit({ evidence: true })).min(1),
});
export type SkillRevision = z.infer<typeof skillRevisionSchema>;

export function mechanismText(mechanism: WritingMechanism, includeQuotes = false): string {
  const evidence = mechanism.evidence.map(({ start, end, quote }) => `${end && end !== start ? `[P${start}]–[P${end}]` : `[P${start}]`}${includeQuotes && quote ? `「${quote}」` : ''}`).join(' ');
  return `## ${mechanism.title}\n\n适用情境：${mechanism.trigger}\n\n${mechanism.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n阅读效果：${mechanism.effect}\n\n### 迁移示例\n\n${mechanism.example}\n\n### 反例与修正\n\n${mechanism.avoid}\n\n检查：${mechanism.check}\n\n证据：${evidence}`;
}

export function researchText(research: SkillResearch): string {
  return `# 文风特征\n\n${research.profile}\n\n${research.mechanisms.map(mechanism => mechanismText(mechanism, true)).join('\n\n')}`;
}
