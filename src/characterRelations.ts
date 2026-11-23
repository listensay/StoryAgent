import dagre from '@dagrejs/dagre';
import { uid, type Note } from './domain';

export const characterNodeSize = { width: 160, height: 80 };
export type CharacterRelation = {
  id: string; sourceId: string; targetId: string; title: string; body: string; noteId?: string;
};

// Only unique, explicit character names can resolve an existing text relationship.
export function characterMentions(text: string, characters: Note[]) {
  let remaining = text;
  let ambiguous = false;
  const mentions = characters.filter((character, index) => character.title.trim() && characters.findIndex(other => other.title.trim() === character.title.trim()) === index)
    .sort((a, b) => b.title.trim().length - a.title.trim().length)
    .filter(character => {
      const name = character.title.trim();
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${/^[\p{L}\p{N}]+$/u.test(name) && !/\p{Script=Han}/u.test(name) ? '(?<![\\p{L}\\p{N}])' : ''}${escaped}${/^[\p{L}\p{N}]+$/u.test(name) && !/\p{Script=Han}/u.test(name) ? '(?![\\p{L}\\p{N}])' : ''}`, 'gu');
      const found = pattern.test(remaining);
      if (found) remaining = remaining.replace(pattern, ' '.repeat(name.length));
      if (found && characters.filter(other => other.title.trim() === name).length !== 1) ambiguous = true;
      return found;
    });
  return ambiguous ? [] : mentions;
}

export function resolveCharacterRelation(note: Note, characters: Note[]) {
  if (note.relation) {
    const { sourceId, targetId } = note.relation;
    return sourceId !== targetId && [sourceId, targetId].every(id => characters.some(character => character.id === id)) ? note.relation : undefined;
  }
  const mentions = characterMentions(`${note.title}\n${note.body}`, characters);
  return mentions.length === 2 ? { sourceId: mentions[0].id, targetId: mentions[1].id } : undefined;
}

export function relationByNames(source: string, target: string, characters: Note[]) {
  const sources = characters.filter(character => character.title.trim() === source.trim());
  const targets = characters.filter(character => character.title.trim() === target.trim());
  return sources.length === 1 && targets.length === 1 && sources[0].id !== targets[0].id ? { sourceId: sources[0].id, targetId: targets[0].id } : undefined;
}

export function buildCharacterGraph(notes: Note[]) {
  const characters = notes.filter(note => note.kind === 'character');
  const relations: CharacterRelation[] = [], unlinked: Note[] = [];
  const pairKey = (sourceId: string, targetId: string) => JSON.stringify([sourceId, targetId].sort());
  const linkedPairs = new Set<string>();
  for (const note of notes.filter(note => note.kind === 'relation')) {
    const endpoints = resolveCharacterRelation(note, characters);
    if (!endpoints) { unlinked.push(note); continue; }
    relations.push({ id: note.id, ...endpoints, title: note.title, body: note.body, noteId: note.id });
    linkedPairs.add(pairKey(endpoints.sourceId, endpoints.targetId));
  }
  // Guided creation and older projects keep relationships inside character profiles.
  for (const character of characters) {
    const sections = [...character.body.matchAll(/(?:^|\n)[#\t *]*(?:\d+[.、．]\s*)?人物关系[\t *]*[：:]?[\t *]*([\s\S]*?)(?=\n[\t ]*#{1,6}[\t ]|\n[\t *]*(?:身份与作用|身份|目标与动机|动机|人物弧线|性格|背景|外貌)[\t *]*[：:]|$)/gu)].map(match => match[1]).join("\n");
    if (!sections) continue;
    for (const sentence of sections.split(/[\n。；;]/u).map(value => value.trim()).filter(Boolean)) {
      const targets = characterMentions(sentence, characters).filter(target => target.id !== character.id);
      if (targets.length !== 1) continue;
      const targetId = targets[0].id, pair = pairKey(character.id, targetId);
      if (linkedPairs.has(pair)) continue;
      linkedPairs.add(pair);
      relations.push({ id: `profile-${character.id}-${targetId}`, sourceId: character.id, targetId, title: sentence, body: sentence });
    }
  }
  return { characters, relations, unlinked };
}

export function layoutCharacters(characters: Note[], relations: CharacterRelation[]) {
  if (!characters.length) return {};
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 96, ranksep: 200, marginx: 32, marginy: 32 });
  graph.setDefaultEdgeLabel(() => ({}));
  characters.forEach(character => graph.setNode(character.id, { ...characterNodeSize }));
  relations.forEach(relation => graph.setEdge(relation.sourceId, relation.targetId, {}, relation.id));
  dagre.layout(graph);
  // Relationships are not a sequence. Compact Dagre's ordering into a grid so
  // cycles cannot turn a small cast into a very long chain of ranks.
  const ordered = [...characters].sort((a, b) => graph.node(a.id).y - graph.node(b.id).y || graph.node(a.id).x - graph.node(b.id).x);
  const columns = Math.ceil(Math.sqrt(characters.length));
  const positions = Object.fromEntries(ordered.map((character, index) => [character.id, { x: 32 + index % columns * 296, y: 32 + Math.floor(index / columns) * 192 }]));
  const pairs = [...new Map(relations.map(relation => [JSON.stringify([relation.sourceId, relation.targetId].sort()), [relation.sourceId, relation.targetId]])).values()];
  const score = () => {
    let total = 0;
    for (const [a, b] of pairs) total += Math.abs(positions[a].x - positions[b].x) + Math.abs(positions[a].y - positions[b].y);
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, d] = pairs[j];
      if (new Set([a, b, c, d]).size < 4) continue;
      if (cross(positions[a], positions[b], positions[c]) * cross(positions[a], positions[b], positions[d]) < 0 && cross(positions[c], positions[d], positions[a]) * cross(positions[c], positions[d], positions[b]) < 0) total += 600;
    }
    return total;
  };
  let best = score();
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i].id, b = ordered[j].id;
      [positions[a], positions[b]] = [positions[b], positions[a]];
      const candidate = score();
      if (candidate < best) { best = candidate; improved = true; }
      else [positions[a], positions[b]] = [positions[b], positions[a]];
    }
    if (!improved) break;
  }
  return positions;
}

export function characterPositions(characters: Note[], layout: Record<string, { x: number; y: number }>) {
  const positions: Record<string, { x: number; y: number }> = {};
  characters.forEach(character => { if (character.graphPosition) positions[character.id] = character.graphPosition; });
  for (const character of characters.filter(value => !value.graphPosition)) {
    const position = { ...layout[character.id] };
    while (Object.values(positions).some(other => Math.abs(other.x - position.x) < characterNodeSize.width + 24 && Math.abs(other.y - position.y) < characterNodeSize.height + 24)) position.y += characterNodeSize.height + 64;
    positions[character.id] = position;
  }
  return positions;
}

export function newCharacterRelation(sourceId = '', targetId = '', title = '', body = ''): Note {
  return { id: uid(), kind: 'relation', title, body, chapterId: '', status: 'confirmed', relation: { sourceId, targetId } };
}

export function retainCharacterRelations(notes: Note[], characterId: string): Note[] {
  const relations = buildCharacterGraph(notes).relations.filter(relation => relation.sourceId === characterId || relation.targetId === characterId);
  return [
    ...notes.map(note => {
      const relation = relations.find(value => value.noteId === note.id);
      return relation && !note.relation ? { ...note, relation: { sourceId: relation.sourceId, targetId: relation.targetId } } : note;
    }),
    ...relations.filter(relation => !relation.noteId).map(relation => newCharacterRelation(relation.sourceId, relation.targetId, relation.title, relation.body)),
  ];
}
