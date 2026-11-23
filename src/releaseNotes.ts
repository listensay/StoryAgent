import source from '../CHANGELOG.md?raw';
import { changelogLimits, compareVersions, parseChangelog, type ChangelogEntry } from './changelog.mjs';
import type { UpdateState } from './appUpdate';

const bundledReleases = parseChangelog(source);

function boundedNotes(notes: string) {
  let remaining = changelogLimits.totalLength;
  return notes.split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean).slice(0, changelogLimits.items).flatMap(line => {
    const text = Array.from(line).slice(0, Math.min(remaining, changelogLimits.itemLength)).join('');
    remaining -= Array.from(text).length;
    return text ? [text] : [];
  });
}

export function updateRecords(state: Pick<UpdateState, 'currentVersion' | 'version' | 'notes' | 'releases'>): ChangelogEntry[] {
  if (!state.currentVersion) return [];
  const ceiling = state.version || state.currentVersion;
  const records = new Map(bundledReleases.filter(record => compareVersions(record.version, ceiling) <= 0).map(record => [record.version, record]));
  for (const record of state.releases) if (compareVersions(record.version, ceiling) <= 0) records.set(record.version, record);
  if (state.version && !records.has(state.version)) records.set(state.version, { version: state.version, date: '', changes: boundedNotes(state.notes) });
  return [...records.values()].sort((a, b) => compareVersions(b.version, a.version));
}
