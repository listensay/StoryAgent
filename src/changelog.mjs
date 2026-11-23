export const changelogLimits = { items: 5, itemLength: 80, totalLength: 300 };
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const length = text => Array.from(text).length;

export function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function validateChangelog(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('CHANGELOG.md must contain version records.');
  for (const [index, entry] of entries.entries()) {
    if (!entry || !versionPattern.test(entry.version) || entry.version.split('.').some(value => !Number.isSafeInteger(Number(value))) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) {
      throw new Error('CHANGELOG.md requires a stable version and a valid YYYY-MM-DD date.');
    }
    if (index && compareVersions(entries[index - 1].version, entry.version) <= 0) throw new Error('CHANGELOG.md versions must be unique and newest first.');
    if (!Array.isArray(entry.changes) || !entry.changes.length || entry.changes.length > changelogLimits.items) throw new Error(`${entry.version}: include 1–${changelogLimits.items} changes.`);
    if (entry.changes.some(change => typeof change !== 'string' || !change.trim() || change !== change.trim() || /[\r\n<>`]|\]\(/.test(change) || length(change) > changelogLimits.itemLength)) {
      throw new Error(`${entry.version}: each change must be plain text of at most ${changelogLimits.itemLength} characters.`);
    }
    if (entry.changes.reduce((total, change) => total + length(change), 0) > changelogLimits.totalLength) throw new Error(`${entry.version}: changes must total at most ${changelogLimits.totalLength} characters.`);
  }
  return entries;
}

export function parseChangelog(source) {
  const entries = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim())) {
    if (!entries.length && line === '# 更新记录') continue;
    const heading = line.match(/^## (\d+\.\d+\.\d+) · (\d{4}-\d{2}-\d{2})$/);
    if (heading) entries.push({ version: heading[1], date: heading[2], changes: [] });
    else if (line.startsWith('- ') && entries.length) entries.at(-1).changes.push(line.slice(2));
    else throw new Error('CHANGELOG.md accepts only version headings and single-line changes.');
  }
  return validateChangelog(entries);
}

export function releaseRecord(source, version) {
  const entries = parseChangelog(source);
  if (entries[0].version !== version) throw new Error(`Add the ${version} record at the top of CHANGELOG.md before releasing.`);
  return entries[0];
}

export function releaseNotes(record) {
  return record.changes.map(change => `- ${change}`).join('\n');
}
