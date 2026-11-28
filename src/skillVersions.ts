import { parse } from 'yaml';
import { now, type Job, type Project, type Skill } from './domain';
import { skillEntry } from './writingSkillTools';

export type SkillPin = NonNullable<Project['skillPins']>[number];
type Revision = Skill['revisions'][number];

// Keep the complete execution definition, never the rolling archive inside it.
export function skillDefinition({ revisions: _history, ...definition }: Skill): SkillPin { return definition; }
export function archiveSkill(skill: Skill): Skill['revisions'] {
  const { version, files, name, description, tasks, resourceMode } = skill;
  return [{ version, files: structuredClone(files), savedAt: now(), metadata: { name, description, tasks: [...tasks], resourceMode } }, ...skill.revisions].slice(0, 5);
}

export function historicalDefinition(skill: Skill, revision: Revision): SkillPin {
  let metadata = revision.metadata;
  // Older archives contain only files. Recover their catalog text from their own
  // entry where possible; never look up resource contents by a version label.
  if (!metadata) {
    const header = skillEntry({ ...skill, files: revision.files })?.content.trimStart().match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
    try {
      const data = header && parse(header[1]);
      if (data) metadata = { name: typeof data.name === 'string' ? data.name : skill.name, description: typeof data.description === 'string' ? data.description : skill.description, tasks: skill.tasks, resourceMode: data.metadata?.storyagent?.resourceMode === 'relevant' ? 'relevant' : undefined };
    } catch { /* Plain-text and manually edited entries are valid legacy files. */ }
  }
  return { ...skillDefinition(skill), ...metadata, resourceMode: metadata ? metadata.resourceMode : skill.resourceMode, version: revision.version, files: revision.files };
}

export function sameEdition(a?: SkillPin, b?: SkillPin) {
  if (!a || !b) return a === b;
  return a.id === b.id && a.version === b.version && a.name === b.name && a.description === b.description && a.resourceMode === b.resourceMode && a.tasks.length === b.tasks.length && a.tasks.every((task, i) => task === b.tasks[i]) && a.files.length === b.files.length && a.files.every((file, i) => file.path === b.files[i].path && file.content === b.files[i].content);
}

export function setProjectPin(project: Project, id: string, definition?: SkillPin) {
  const pins = (project.skillPins ?? []).filter(pin => pin.id !== id);
  if (definition) {
    if (definition.id !== id || !skillEntry({ ...definition, revisions: [] })?.content.trim()) throw new Error('该版本缺少有效的 SKILL.md');
    pins.push(structuredClone(definition));
    if (!project.skillIds.includes(id)) project.skillIds.push(id);
  }
  project.skillPins = pins.length ? pins : undefined;
  project.updatedAt = now();
}

export function captureJobPins(job: Job, project?: Project) {
  job.skillIds ??= [...(project?.skillIds ?? [])];
  // [] distinguishes a job launched without pins from a legacy, uncaptured job.
  job.skillPins ??= structuredClone((project?.skillPins ?? []).filter(pin => job.skillIds!.includes(pin.id)));
}

export function executionSkills(skills: Skill[], job: Job, project?: Project): Skill[] {
  const chosen = job.skillIds ?? project?.skillIds ?? [];
  const pins = (job.skillPins ?? project?.skillPins ?? []).filter(pin => chosen.includes(pin.id));
  if (!pins.length) return skills;
  const pinned = new Map(pins.map(pin => [pin.id, { ...pin, revisions: [] } as Skill]));
  // A project pin can outlive both its archive entry and the library Skill.
  return [...skills.filter(skill => !pinned.has(skill.id)), ...pinned.values()];
}
