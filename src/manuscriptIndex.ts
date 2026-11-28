import { characterSections } from './characterProfile';
import { buildCharacterGraph, newCharacterRelation } from './characterRelations';
import { noteNames, now, snapshot, type NoteKind, type Project, type Workspace } from './domain';

export const searchScopes = { all: '全部内容', manuscript: '正文', people: '人物', world: '世界设定', outline: '总纲', plan: '细纲', planning: '规划' } as const;
export type SearchScope = keyof typeof searchScopes;
type Category = Exclude<SearchScope, 'all'>;
type Target = { owner: 'project'; slot: 'outline' } | { owner: 'chapter'; slot: 'title' | 'content' | 'plan' } | { owner: 'note'; slot: 'title' | 'body' };
type Span = { start: number; end: number; label: string; name?: boolean; indents?: number[] };
export type SearchField = Target & {
  key: string; id: string; category: Category; title: string; label: string; source: string;
  start: number; end: number; profileBody?: string; indents?: number[]; conflictingName?: boolean;
};
export type MatchGroup = { field: SearchField; offsets: number[] };
export type Replacement = MatchGroup & { after: string };
export type ReplacementPreview = { projectId: string; scope: SearchScope; query: string; replacement: string; changes: Replacement[] };
const noteCategories: Partial<Record<NoteKind, Category>> = { character: 'people', relation: 'people', world: 'world', volume: 'planning', scene: 'planning', branch: 'planning' };

// parseCharacterProfile returns normalized values for the form. Here we need their original
// source ranges: serializing the whole form would rewrite legacy prose, CRLF and whitespace.
function profileSpans(body: string): Span[] {
  const parts: Span[] = [];
  let section: typeof characterSections[number] | undefined, active: Span | undefined;
  let field = false, extra = false;
  for (const line of body.matchAll(/([^\r\n]*)(?:\r\n|[\r\n]|$)/g)) {
    const start = line.index!, text = line[1], end = start + text.length;
    if (!line[0]) break;
    if (!extra && !(field && text.startsWith('  '))) {
      const heading = text.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u);
      if (heading) {
        const title = heading[1].replace(/\*\*/g, '').replace(/^\d+[.、．]\s*/, '').trim();
        section = characterSections.find(item => item.title === title);
        active = undefined; field = false; extra = title === '补充设定';
        if (section || extra) continue;
      }
      const entry = section && text.match(/^\s*(?:[-*+]\s+)?(?:\*\*)?([^：:*]+?)(?:\*\*)?\s*[：:]\s*(?:\*\*)?(.*)$/u);
      const label = entry?.[1].trim();
      if (section && entry && label && (section.fields as readonly string[]).includes(label)) {
        active = { start: end - entry[2].length, end, label: `${section.title} / ${label}`, name: label === '姓名' };
        parts.push(active); field = true; continue;
      }
    }
    if (active) {
      active.end = end;
      if (field && text.startsWith('  ')) (active.indents ??= []).push(start);
    } else { active = { start, end, label: extra ? '补充设定' : '人物档案' }; parts.push(active); }
  }
  return parts;
}
function mirroredName(body: string, part: Span) {
  const raw = body.slice(part.start, part.end), trimmed = raw.trim();
  const bold = body.slice(Math.max(0, part.start - 2), part.start) === '**' && trimmed.endsWith('**');
  return { at: part.start + (trimmed ? raw.indexOf(trimmed) : 0), value: bold ? trimmed.slice(0, -2) : trimmed };
}

export function manuscriptFields(project: Project, scope: SearchScope): SearchField[] {
  const fields: SearchField[] = [];
  const includes = (category: Category) => scope === 'all' || scope === category;
  const add = (target: Target, category: Category, id: string, title: string, source: string, label: string, start = 0, end = source.length, options: Pick<SearchField, 'profileBody' | 'indents' | 'conflictingName'> = {}) => {
    if (end > start) fields.push({ ...target, category, id, title, label, source, start, end, ...options, key: JSON.stringify([target.owner, id, target.slot, start]) });
  };
  for (const chapter of project.chapters) {
    if (includes('manuscript')) {
      add({ owner: 'chapter', slot: 'title' }, 'manuscript', chapter.id, chapter.title, chapter.title, '章节标题');
      add({ owner: 'chapter', slot: 'content' }, 'manuscript', chapter.id, chapter.title, chapter.content, '正文');
    }
    if (includes('plan')) add({ owner: 'chapter', slot: 'plan' }, 'plan', chapter.id, chapter.title, chapter.plan, '章节细纲');
  }
  if (includes('outline')) add({ owner: 'project', slot: 'outline' }, 'outline', project.id, project.title, project.outline, '故事总纲');
  for (const note of project.notes) {
    const category = noteCategories[note.kind];
    if (!category || !includes(category)) continue;
    const person = note.kind === 'character';
    add({ owner: 'note', slot: 'title' }, category, note.id, note.title, note.title, person ? '人物姓名' : `${noteNames[note.kind]}名称`, 0, note.title.length, person ? { profileBody: note.body } : {});
    if (person) {
      for (const part of profileSpans(note.body)) {
        // A divergent legacy name is searchable, but is not an independent writable alias.
        const mirror = part.name ? mirroredName(note.body, part).value : undefined;
        if (part.name && (!mirror || mirror === note.title.trim())) continue;
        add({ owner: 'note', slot: 'body' }, category, note.id, note.title, note.body, part.label, part.start, part.end, { indents: part.indents, conflictingName: part.name });
      }
    } else add({ owner: 'note', slot: 'body' }, category, note.id, note.title, note.body, noteNames[note.kind]);
  }
  return fields;
}

// Offsets are UTF-16 indices in the original field, also used by the chapter editor selection.
export function findMatches(fields: SearchField[], query: string): MatchGroup[] {
  if (!query) return [];
  const groups: MatchGroup[] = [];
  for (const field of fields) {
    const offsets: number[] = [];
    const scan = (start: number, end: number) => {
      const text = field.source.slice(start, end);
      for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) offsets.push(start + at);
    };
    let start = field.start;
    for (const indent of field.indents ?? []) { scan(start, indent); start = indent + 2; }
    scan(start, field.end);
    if (offsets.length) groups.push({ field, offsets });
  }
  return groups;
}
export const matchCount = (groups: MatchGroup[]) => groups.reduce((count, group) => count + group.offsets.length, 0);
export function preparePreview(projectId: string, scope: SearchScope, groups: MatchGroup[], query: string, replacement: string): ReplacementPreview {
  if (!query || !groups.length || replacement === query) throw new Error('没有需要替换的内容');
  if (matchCount(groups) * (replacement.length - query.length) > 16 * 1024 * 1024) throw new Error('替换后的内容过长，请缩小搜索范围');
  const changes = groups.map(group => {
    const { field, offsets } = group, pieces: string[] = [];
    let cursor = field.start;
    for (const at of offsets) { pieces.push(field.source.slice(cursor, at), replacement); cursor = at + query.length; }
    return { ...group, after: pieces.join('') + field.source.slice(cursor, field.end) };
  });
  return { projectId, scope, query, replacement, changes };
}

export function busyChapterIds(state: Workspace, projectId: string, polishing: string[]) {
  return new Set([...polishing, ...state.jobs.filter(job => job.projectId === projectId && ['queued', 'running'].includes(job.status)).flatMap(job => job.steps.map(step => step.chapterId))]);
}
function syncedProfile(body: string, oldName: string, name: string) {
  // The title and the profile's 姓名 are one logical search result. Legacy free-form
  // profiles have no mirror. Never insert a template into them as a side effect.
  for (const part of profileSpans(body).filter(part => part.name).reverse()) {
    const { at, value } = mirroredName(body, part);
    if (value && value !== oldName.trim()) throw new Error(`「${oldName}」的姓名与人物档案不一致，请先核对档案`);
    body = body.slice(0, at) + name + body.slice(at + value.length);
  }
  return body;
}
export function replacementIssue(project: Project, changes: Replacement[], busy: Set<string>): string {
  const names = new Map<string, string>();
  for (const { field, after } of changes) {
    if (field.owner === 'chapter' && busy.has(field.id)) return `「${field.title}」正在生成或润色，请取消勾选该章或等待完成`;
    if (field.conflictingName) return `「${field.title}」的姓名与人物档案不一致，请先核对档案`;
    if (field.slot === 'title' && !after.trim()) return `「${field.title}」的名称不能为空`;
    if (field.profileBody !== undefined) {
      if (after.trim() !== after) return '人物姓名首尾不能含空格';
      names.set(field.id, after);
      try { syncedProfile(field.profileBody, field.title, after); } catch (error) { return error instanceof Error ? error.message : String(error); }
    }
  }
  if (names.size) {
    const counts = new Map<string, number>();
    for (const person of project.notes.filter(note => note.kind === 'character')) {
      const name = names.get(person.id) ?? person.title.trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const name of names.values()) if (counts.get(name)! > 1) return `已有同名人物「${name}」`;
  }
  return '';
}
function sameField(a: SearchField, b: SearchField) {
  return a.key === b.key && a.title === b.title && a.category === b.category && a.label === b.label && a.end === b.end && a.source === b.source && a.profileBody === b.profileBody;
}
export function resolveMatch(project: Project, field: SearchField) {
  return manuscriptFields(project, field.category).find(current => sameField(current, field));
}

// Called inside one synchronous store.update. No previewed project object is copied back;
// unrelated edits, graph positions, versions and jobs all come from the live draft.
export function applyReplacement(state: Workspace, preview: ReplacementPreview, excluded: Set<string>, polishing: string[]) {
  const project = state.projects.find(project => project.id === preview.projectId);
  if (!project || state.activeProjectId !== project.id) throw new Error('当前项目已切换，请重新搜索');
  const changes = preview.changes.filter(change => !excluded.has(change.field.key));
  if (!changes.length) throw new Error('请先选择替换内容');
  const current = new Map(manuscriptFields(project, preview.scope).map(field => [field.key, field]));
  for (const { field } of changes) {
    const live = current.get(field.key);
    if (!live || !sameField(live, field)) throw new Error(`「${field.title}」已变更，请返回搜索并重新预览`);
  }
  if (!excluded.size) {
    const reviewed = new Set(changes.map(change => change.field.key));
    if ([...current.values()].some(field => !reviewed.has(field.key) && findMatches([field], preview.query).length)) throw new Error('出现新的匹配内容，请返回搜索并重新预览');
  }
  const issue = replacementIssue(project, changes, busyChapterIds(state, project.id, polishing));
  if (issue) throw new Error(issue);

  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const notes = new Map(project.notes.map(note => [note.id, note]));
  const renames = new Map(changes.filter(change => change.field.profileBody !== undefined).map(change => [change.field.id, change]));
  const changedRelations = new Set(changes.filter(({ field }) => field.owner === 'note' && notes.get(field.id)?.kind === 'relation').map(({ field }) => field.id));
  const links = renames.size || changedRelations.size ? buildCharacterGraph(project.notes).relations : [];
  for (const link of links) if (link.noteId && (renames.has(link.sourceId) || renames.has(link.targetId) || changedRelations.has(link.noteId))) {
    const note = notes.get(link.noteId)!;
    note.relation ??= { sourceId: link.sourceId, targetId: link.targetId };
  }

  const bodies = new Map<string, Replacement[]>();
  const timestamp = now();
  for (const change of changes) {
    const { field, after } = change;
    if (field.owner === 'chapter') {
      const chapter = chapters.get(field.id)!;
      if (field.slot === 'content') {
        Object.assign(chapter, snapshot(chapter, '批量替换前'));
        // store.update invalidates the derived summary/notes for changed content.
        chapter.memoryHash = undefined;
      }
      chapter[field.slot] = after; chapter.updatedAt = timestamp;
    } else if (field.owner === 'project') project.outline = after;
    else if (field.slot === 'title') notes.get(field.id)!.title = after;
    else {
      const list = bodies.get(field.id);
      if (list) list.push(change); else bodies.set(field.id, [change]);
    }
  }
  for (const [id, parts] of bodies) {
    const note = notes.get(id)!, pieces: string[] = [];
    let cursor = 0;
    for (const { field, after } of parts.sort((a, b) => a.field.start - b.field.start)) {
      pieces.push(note.body.slice(cursor, field.start), after); cursor = field.end;
    }
    note.body = pieces.join('') + note.body.slice(cursor);
  }
  for (const [id, { field, after }] of renames) {
    const note = notes.get(id)!;
    note.body = syncedProfile(note.body, field.title, after);
  }
  // Keep profile-inferred edges when an author renames a person but does not rename
  // the mention in the other person's profile. Do not duplicate edges that still resolve.
  if (renames.size && links.some(link => !link.noteId)) {
    const pair = (a: string, b: string) => JSON.stringify([a, b].sort());
    const pairs = new Set(buildCharacterGraph(project.notes).relations.map(link => pair(link.sourceId, link.targetId)));
    for (const link of links) if (!link.noteId && (renames.has(link.sourceId) || renames.has(link.targetId)) && !pairs.has(pair(link.sourceId, link.targetId))) {
      project.notes.push(newCharacterRelation(link.sourceId, link.targetId, link.title, link.body));
      pairs.add(pair(link.sourceId, link.targetId));
    }
  }
  project.updatedAt = timestamp;
}
