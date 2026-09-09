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

// The version-bump commit the release skill makes. It describes the release
// itself, not anything in it, so it never belongs in the notes — not even in
// the catch-all below.
const RELEASE_COMMIT = /^release(?:\([^)]*\))?!?:/i;

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

  const sections = SECTIONS
    .filter(s => grouped.get(s.type).length > 0)
    .map(s => [s.heading, ...grouped.get(s.type).map(e => `- ${e}`)].join('\n'));

  // A range of pure chore/ci/docs commits would otherwise yield an empty body,
  // and the What's New modal would say there are no notes for a version that
  // demonstrably changed something. List everything instead — blunt, but honest.
  if (sections.length === 0) return buildFallbackNotes(subjects);

  return sections.join('\n\n');
}

function buildFallbackNotes(subjects) {
  const entries = [];

  for (const raw of subjects) {
    const subject = raw.trim();
    if (!subject || RELEASE_COMMIT.test(subject)) continue;
    // Keep the type prefix here: with no section headings to group by, "chore:"
    // is the only thing telling the reader what kind of change this was.
    const entry = capitalize(subject.replace(/\.$/, ''));
    if (!entries.includes(entry)) entries.push(entry);
  }

  if (entries.length === 0) return '';
  return ['## Changes', ...entries.map(e => `- ${e}`)].join('\n');
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
