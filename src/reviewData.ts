import { z } from 'zod';

const finding = z.object({ category: z.enum(['fact', 'expression']), quote: z.string().trim().min(1), paragraph: z.number().int().positive().optional(), reason: z.string().trim().min(1), suggestion: z.string().trim().min(1) });
export const issueSchema = finding.extend({ id: z.string(), start: z.number().int(), status: z.enum(['open', 'editing', 'later', 'ignored', 'resolved']), checked: z.object({ hash: z.string(), text: z.string() }).optional(), resolvedHash: z.string().optional() });
export type ReviewIssue = z.infer<typeof issueSchema>;
export const reviewLabels = { fact: '事实矛盾', expression: '表达建议' } as const;
export const reviewRules = '审查本章及跨章连续性。只列有依据的问题，分为事实矛盾 fact 与表达建议 expression。quote 逐字摘录本章一段可定位的连续原文，不含段落编号或省略号；paragraph 是该段的 P 编号数字。reason 说明原因，涉及其他章节时注明证据，suggestion 给出修订方向。无问题返回空数组。只返回 JSON：{"issues":[{"category":"fact 或 expression","paragraph":1,"quote":"原句","reason":"原因","suggestion":"建议"}]}。汇总时保留各问题的原句与段落编号。';
function unique(text: string, value: string) {
  if (!value) return -1;
  const i = text.indexOf(value); return i !== -1 && text.indexOf(value, i + 1) === -1 ? i : -1;
}
export function readReview(output: string, base: string): ReviewIssue[] {
  let parsed: unknown;
  try { parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')); } catch { throw new Error('审稿结果格式不完整，请重试当前步骤'); }
  const result = z.object({ issues: z.array(finding) }).safeParse(parsed);
  if (!result.success) throw new Error('审稿结果缺少分类、引文或建议，请重试当前步骤');
  const paragraphs = Array.from(base.matchAll(/[^\n]+/g)).filter(m => m[0].trim());
  return result.data.issues.map(item => {
    const p = item.paragraph && paragraphs[item.paragraph - 1];
    const local = p ? unique(p[0], item.quote) : -1;
    const start = p && local >= 0 ? p.index + local : unique(base, item.quote);
    return { ...item, id: crypto.randomUUID(), start, status: 'open' };
  });
}
export function reviewReport(issues: ReviewIssue[]) {
  return issues.length ? issues.map(i => `### ${reviewLabels[i.category]}${i.paragraph ? ` [P${i.paragraph}]` : ''}\n\n> ${i.quote}\n\n${i.reason}\n\n建议：${i.suggestion}`).join('\n\n') : '本次审稿未列出问题。';
}
// Only jump to verified evidence. After editing, a unique pair of unchanged
// boundaries can recover the replacement span, even if the quote was removed.
export function reviewRange(base: string, current: string, issue: ReviewIssue) {
  const { quote, start } = issue;
  if (start < 0 || base.slice(start, start + quote.length) !== quote) return;
  if (base === current) return { start, end: start + quote.length };
  const before = base.slice(Math.max(0, start - 40), start), after = base.slice(start + quote.length, start + quote.length + 40);
  const l = before ? unique(current, before) : 0, r = after ? unique(current, after) : current.length;
  if (l >= 0 && r >= l + before.length && (before || after)) return { start: l + before.length, end: r };
  const at = unique(current, quote);
  if (at >= 0 && unique(base, quote) === start) return { start: at, end: at + quote.length };
}
