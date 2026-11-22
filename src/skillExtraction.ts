import { parse, stringify } from 'yaml';
import type { Job, Skill } from './domain';
import { parseSkills } from './skills';
import { mechanismCategories, mechanismText, skillCompositionSchema, skillResearchSchema, type SkillComposition, type SkillResearch, type SkillRevision } from './skillExtractionData';
import { skillApplicationRules } from './skillResources';

class ResearchFormatError extends Error {
  constructor(readonly feedback: string) { super('写法提炼结果缺少情境、步骤、示例或证据，请重新生成'); }
}

function researchJSON(output: string): unknown {
  const text = output.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(text); } catch { /* Only repair lossless JSON formatting errors. */ }
  let repaired = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (!escaped && char === '"') quoted = false;
      if (!escaped && char.charCodeAt(0) < 32) repaired += JSON.stringify(char).slice(1, -1);
      else repaired += char;
      escaped = !escaped && char === '\\';
    } else {
      if (char === '"') quoted = true;
      if (char !== ',' || !/^\s*[}\]]/.test(text.slice(i + 1))) repaired += char;
    }
  }
  try { return JSON.parse(repaired); }
  catch { throw new ResearchFormatError('JSON 未闭合或格式无效；字符串内换行使用 \\n，确保所有对象和数组完整闭合，不添加说明。'); }
}

export function parseSkillResearch(output: string, section: string): SkillResearch {
  const parsed = skillResearchSchema.safeParse(researchJSON(output));
  if (!parsed.success) throw new ResearchFormatError(parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || '根对象'}：${issue.message}`).join('；'));
  const research = parsed.data;
  const paragraphs = new Set([...section.matchAll(/\[P(\d+)\]/g)].map(match => Number(match[1])));
  const fragments = [...section.matchAll(/\[P(\d+)\] ([\s\S]*?)(?=\n\n\[P\d+\] |$)/g)].map(match => ({ number: Number(match[1]), content: match[2].replace(/\s+/g, '') }));
  const quotedSource = fragments.map(fragment => fragment.content).join('');
  const original = section.replace(/\[P\d+\]/g, '').replace(/[\s\p{P}]/gu, '');
  for (const mechanism of research.mechanisms) {
    for (const evidence of mechanism.evidence) {
      const { start, end = start, quote } = evidence;
      const validRange = end >= start && paragraphs.has(start) && paragraphs.has(end);
      const range = fragments.filter(fragment => fragment.number >= start && fragment.number <= end).map(fragment => fragment.content).join('');
      const normalizedQuote = quote?.replace(/\s+/g, '') ?? '';
      if (!normalizedQuote || !validRange || !range.includes(normalizedQuote)) {
        const position = normalizedQuote ? quotedSource.indexOf(normalizedQuote) : -1;
        // A correct quote can carry a mistaken P label. Repair it only when the
        // complete quote has one exact location in this source section.
        if (position < 0 || quotedSource.indexOf(normalizedQuote, position + 1) >= 0) throw new Error(validRange ? '写法证据的短引文与原文不符，请重新生成' : '写法证据超出所选原文，请重新生成');
        let offset = 0;
        for (const fragment of fragments) {
          if (position >= offset && position < offset + fragment.content.length) evidence.start = fragment.number;
          if (position + normalizedQuote.length > offset && position + normalizedQuote.length <= offset + fragment.content.length) evidence.end = fragment.number;
          offset += fragment.content.length;
        }
        if (evidence.start === evidence.end) delete evidence.end;
      }
      // Some models return a whole cited passage. Verify it in full before
      // retaining a short quote, rather than rejecting otherwise useful work.
      evidence.quote = quote!.slice(0, 40);
    }
    const example = mechanism.example.replace(/[\s\p{P}]/gu, '');
    for (let i = 0; i + 40 <= example.length; i++) if (original.includes(example.slice(i, i + 40))) throw new Error('迁移示例包含原文段落，请重新生成');
  }
  return research;
}

async function generateValidatedSkill(signal: AbortSignal, request: (feedback: string) => Promise<string>, validate: (output: string) => unknown): Promise<string> {
  let feedback = '';
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const output = await request(feedback);
      signal.throwIfAborted();
      return JSON.stringify(validate(output));
    }
    catch (error) {
      signal.throwIfAborted();
      if (attempt >= 2) throw error;
      const truncated = error instanceof Error && error.message === '已达到输出上限，可继续生成';
      if (!(error instanceof ResearchFormatError) && !truncated && !(error instanceof Error && /写法证据|迁移示例/.test(error.message))) throw error;
      const reason = error instanceof ResearchFormatError ? error.feedback : error instanceof Error ? error.message : String(error);
      feedback = `\n上次结果校验失败：${reason}。${truncated ? '减少本次选取的写法数量及重复说明，使完整 JSON 能在输出预算内结束；每项仍保留全部字段、正文示例与反例。' : ''}重新输出当前任务要求的完整 JSON，修正上述字段；研究机制须包含 check，原文证据的编号和连续短引文须准确，综合入口使用研究中已有的证据编号；不附说明或代码围栏。\n`;
    }
  }
}

export const generateSkillResearch = (section: string, signal: AbortSignal, request: (feedback: string) => Promise<string>) => generateValidatedSkill(signal, request, output => parseSkillResearch(output, section));

export function parseSkillComposition(output: string, job: Job): SkillComposition {
  const parsed = skillCompositionSchema.safeParse(researchJSON(output));
  if (!parsed.success) throw new ResearchFormatError(parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || '根对象'}：${issue.message}`).join('；'));
  const evidence = new Set(job.steps.flatMap(step => step.research?.mechanisms.flatMap(mechanism => mechanism.evidence.flatMap(({ start, end }) => end && end !== start ? [start, end] : [start])) ?? []));
  if (parsed.data.expression.some(item => item.evidence.some(paragraph => !evidence.has(paragraph)))) throw new ResearchFormatError('expression.evidence 须使用分段研究中已有的证据起止 P 编号，不补造原文依据。');
  const original = job.sourceText.replace(/[\s\p{P}]/gu, '');
  for (const item of parsed.data.expression) {
    const example = item.example.replace(/[\s\p{P}]/gu, '');
    for (let i = 0; i + 40 <= example.length; i++) if (original.includes(example.slice(i, i + 40))) throw new Error('迁移示例包含原文段落，请重新生成');
  }
  return parsed.data;
}

export const generateSkillComposition = (job: Job, signal: AbortSignal, request: (feedback: string) => Promise<string>) => generateValidatedSkill(signal, request, output => parseSkillComposition(output, job));

export function composedSkillText(composition: SkillComposition | SkillRevision): string {
  const metadata = stringify({ name: composition.name, description: composition.description }).trimEnd();
  const expression = composition.expression.map(item => `### ${item.title}\n\n${item.guideline}\n\n适用边界：${item.boundary}\n\n示例：\n\n${item.example}${'evidence' in item ? `\n\n研究依据：${item.evidence.map(paragraph => `[P${paragraph}]`).join(' ')}` : ''}`).join('\n\n');
  return `---\n${metadata}\n---\n\n# 写作方法\n\n## 文风基准\n\n${composition.profile}\n\n## 执行顺序\n\n1. 先确认作者当前小说的设定、本章事件、人物目标与表达基调。原作的人物身份、经营方式和具体事件不作为新故事的前提。\n2. 将下列表达方法用于当前人物的叙述、对白和句段节拍。各项边界仅约束该项写法，人物可以有不同的态度、目的和选择。词汇和口吻服从当前人物身份与作者要求，行业话术只在相应情境中使用。\n3. 按当前场景从详细资源中选择少量适用机制，保留步骤、正文示例与反例；不适用的机制跳过，不为套用某个机制新增事件，也不要求每章凑齐全部机制。\n4. 将方法落实为人物动作、对白、感受和反应。沿用表达方法，重新设计符合当前人物目标的具体内容；不复演参考小说或资源示例中的事件。\n5. 检查正文是否完成本章任务、保持选定文风，并删去重复释义和替人物总结道理的旁白。\n\n${skillApplicationRules}\n\n## 表达方法\n\n${expression}`;
}

export const skillSnapshot = (skill: Skill) => JSON.stringify({ name: skill.name, description: skill.description, version: skill.version, tasks: skill.tasks, files: skill.files });

export function markRelevantResources(content: string): string {
  const frontmatter = content.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!frontmatter) throw new Error('Skill 缺少元数据');
  const metadata = parse(frontmatter[1]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Skill 元数据格式无效');
  const existing = metadata.metadata && typeof metadata.metadata === 'object' && !Array.isArray(metadata.metadata) ? metadata.metadata : {};
  const storyagent = existing.storyagent && typeof existing.storyagent === 'object' && !Array.isArray(existing.storyagent) ? existing.storyagent : {};
  metadata.metadata = { ...existing, storyagent: { ...storyagent, resourceMode: 'relevant' } };
  return `---\n${stringify(metadata).trimEnd()}\n---\n\n${content.slice(frontmatter[0].length).trim()}`;
}

export function extractedSkillFiles(job: Job, output: string): Skill['files'] {
  const content = output.trim().replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```$/, '').replace(/\]\(file:\/+(references\/index\.md)\)/g, ']($1)');
  // Validate the executable entry point before creating any saved resources.
  parseSkills([{ path: 'SKILL.md', content }], job.sourceTitle);
  if (!content.replace(/^\uFEFF?---\s*\n[\s\S]*?\n---(?:\s*\n|$)/, '').trim()) throw new Error('Skill 正文为空，请重新生成');
  const research = job.steps.filter(step => step.stage === 'style-research');
  if (!research.length) return [{ path: 'SKILL.md', content }];
  if (research.some(step => !step.research || !['ready', 'accepted'].includes(step.status))) throw new Error('写法提炼尚未完成');
  const files: Skill['files'] = [];
  const index: string[] = [];
  for (const step of research) for (const mechanism of step.research!.mechanisms) {
    const path = `references/${mechanism.category}/${String(files.length + 1).padStart(3, '0')}.md`;
    files.push({ path, content: `# ${mechanismCategories[mechanism.category]}\n\n${mechanismText(mechanism)}` });
    index.push(`- [${mechanism.title}](${path.replace(/^references\//, '')})：${mechanism.trigger}`);
  }
  const definition = `${markRelevantResources(content)}\n\n## 写法资源\n\n结合当前任务提供的详细写法执行，按情境选用，避免逐项套用。完整目录见 [写法目录](references/index.md)。\n`;
  return [{ path: 'SKILL.md', content: definition }, { path: 'references/index.md', content: `# 写法目录\n\n${index.join('\n')}\n` }, ...files];
}

export const researchExtractionRules = '从本段原文提炼具体、可迁移的写法，保留可辨认的文风。先观察叙述和对白实际上怎样写，说明口语程度、词汇、句法、解释密度、叙述态度和阅读乐趣。先提炼有证据的表达写法，再补充场景、情绪与情节机制；不能只复述题材设定、主角经营方案或剧情套路。分类必须准确：voice 是叙述距离、用词与语气；dialogue 是台词、动作与人物关系形成的潜台词；rhythm 是句段长短、停顿与转折的节拍；场景的事件顺序归 scene，故事布局归 plot。剧情中的误会本身不能冒充叙述口吻或句法分析。每项必须给出适用情境、可执行步骤、阅读效果、原创迁移示例、具体反例及修正、自检和准确的原文证据。表达类的 trigger 描述人物处境、关系、信息差与叙述位置，不将原作阵营、修为、经营模式或产品当作前提；例如掩饰失误的台词与动作反差，适用条件是“人物怕暴露失误，需要维持体面”，无需他是宗门强者。只有方法确实依赖某类题材时才保留题材限制。steps 写叙述、台词、动作与信息如何安排，不能直接规定人物采用原作的行动方案。证据必须包含所引P段中的连续短引文（2–40字，不加省略号），以实际措辞支撑写法判断，而不是仅证明这段剧情出现过；不能从修真背景推断古风文言，不能把直白口语和现代名词改成自造的玄奥术语。示例写成一小段实际正文，展示动作与对白，改变人物目标与核心冲突；仅把仙侠改为西幻、替换人名与工具并重演同一件事不算迁移，也不能写成“主角让某人做某事”的方案概要。示例不复用原作专名、台词或独特情节。示例的用词、句法、叙述距离和对白密度须贴近原文的实际表达，不用仿古辞藻或冗长专业说理代替通俗口语。只提取有证据的维度；喜剧解释预期、错位、落点与反应，其他基调不强加幽默。区分可迁移写法与原作题材中的具体应用，机制的适用情境要以人物处境和阅读效果表述，题材限制仅在确实必要时注明。反例说明某种写法何时失效与怎样修正，不能将原作的一次选择写成所有创作都必须遵守的禁令。不同情境的变体分别保留，只合并真正重复的写法，不用通用因果清单代替实际写法。名称使用清楚的短语，避免堆砌术语。只输出 JSON：{"profile":"以实际表达为依据的文风特征","mechanisms":[{"title":"具体写法名称","category":"voice|dialogue|rhythm|emotion|scene|plot 中的一项","trigger":"适用情境与边界","steps":["具体步骤"],"effect":"如何产生阅读效果","example":"改变人物目标与核心冲突的原创正文片段","avoid":"具体反例及修正","check":"成稿检查","evidence":[{"start":原文P编号,"end":范围末尾P编号，单段可省略,"quote":"该P范围内的连续短引文"}]}]}。';
