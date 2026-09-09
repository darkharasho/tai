// Build user-facing release notes from conventional commit subjects.
//
// The release skill normally writes hand-polished notes onto a draft release
// before CI runs. When that draft is missing, CI used to fall back to
// `gh release create --generate-notes`, which produces a body containing
// nothing but a "Full Changelog" link — and the in-app What's New modal then
// rendered a release whose only content was a link to GitHub. This gives CI a
// real fallback body instead.
import { execFileSync } from 'node:child_process';

// Commit types users care about. Everything else (chore, ci, docs, style,
// refactor, test, build, release) is internal churn.
const SECTIONS = [
  { type: 'feat', heading: "## What's New" },
  { type: 'fix', heading: '## Bug Fixes' },
];

const SUBJECT = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;

export function buildReleaseNotes(subjects) {
  const grouped = new Map(SECTIONS.map(s => [s.type, []]));

  for (const raw of subjects) {
    const match = SUBJECT.exec(raw.trim());
    if (!match) continue;
    const bucket = grouped.get(match[1].toLowerCase());
    if (!bucket) continue;
    const entry = capitalize(match[2].trim().replace(/\.$/, ''));
    if (entry && !bucket.includes(entry)) bucket.push(entry);
  }

  return SECTIONS
    .filter(s => grouped.get(s.type).length > 0)
    .map(s => [s.heading, ...grouped.get(s.type).map(e => `- ${e}`)].join('\n'))
    .join('\n\n');
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export function commitSubjects(fromRef, toRef) {
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;
  const out = execFileSync('git', ['log', range, '--no-merges', '--pretty=format:%s'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(line => line.trim() !== '');
}

// `git describe` on the tag itself would return the tag; exclude it so we get
// the release before this one.
export function previousTag(toRef) {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', `${toRef}^`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const toRef = process.argv[2] ?? 'HEAD';
  const fromRef = process.argv[3] ?? previousTag(toRef);
  const notes = buildReleaseNotes(commitSubjects(fromRef, toRef));
  // An empty body is better than a link-only body: GitHub shows the tag and
  // assets, and the What's New modal skips releases with no notes.
  process.stdout.write(notes);
}
