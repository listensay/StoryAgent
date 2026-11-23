export type ChangelogEntry = { version: string; date: string; changes: string[] };
export const changelogLimits: { items: number; itemLength: number; totalLength: number };
export function compareVersions(left: string, right: string): number;
export function validateChangelog(entries: unknown): ChangelogEntry[];
export function parseChangelog(source: string): ChangelogEntry[];
export function releaseRecord(source: string, version: string): ChangelogEntry;
export function releaseNotes(record: ChangelogEntry): string;
