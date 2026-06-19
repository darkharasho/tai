# Predictive Commands P1 — Command Index + Frecency Ghost Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Command Index foundation and make ghost-text suggestions frecency- and cwd-aware.

**Architecture:** A pure, capped, aggregated `CommandIndex` (keyed by command, holding count/recency/per-cwd/next-adjacency) is built from finished blocks + shell history, persisted as capped JSON in userData, held in renderer memory for synchronous ranking, and consumed by the ghost-text predictor. This phase publishes the index interfaces the later phases (P2 next-command, P4 palette) consume.

**Tech Stack:** TypeScript, React (renderer), Electron (main), Vitest (`maxForks: 2`).

## Global Constraints

- Run tests with `npm test` (alias `vitest run --config tests/vitest.config.ts`). NEVER bare `npx vitest run`. Baseline: 589 test files green; keep green and `npx tsc --noEmit` clean.
- `@/` is the alias for `src/`.
- No new native dependency — persistence is capped JSON in `app.getPath('userData')`, matching `electron/services/notify.ts`.
- All ranking/index logic is **pure functions** (no I/O) so they unit-test without a shell, AI, or filesystem.
- The index is **bounded**: `MAX_INDEX_COMMANDS`, `MAX_CWD_BUCKETS`, `MAX_NEXT_BUCKETS`; eviction is frecency-based. Load is defensive (corrupt/oversized JSON → empty index).
- Named consts for all weights/caps, co-located in `commandIndex.ts`.
- Commit after every task.

## File Structure

- `src/utils/commandIndex.ts` — pure index type + operations (create/ingest/cap/frecency/rankPrefix/topNext). New.
- `electron/services/commandIndexStore.ts` — userData JSON load/save (debounced) + IPC handlers. New.
- `src/hooks/useGhostText.ts` — evolve `predictCommand` to index+cwd-aware frecency. Modify.
- `src/components/TerminalInput.tsx` — pass index + cwd to the predictor. Modify.
- `src/components/TerminalSession.tsx` — ingest blocks at finalize, load index into renderer state. Modify.
- `electron/preload.ts` + `src/types/window.d.ts` — IPC surface for the index. Modify.

---

### Task 1: Command Index core — structure + ingestion + cap

**Files:**
- Create: `src/utils/commandIndex.ts`
- Test: `tests/unit/commandIndex.test.ts`

**Interfaces:**
- Produces:
  - `interface CommandStat { command: string; count: number; lastTs: number; cwdCounts: Record<string, number>; lastExitCode?: number }`
  - `interface CommandIndex { stats: Record<string, CommandStat>; next: Record<string, Record<string, number>> }`
  - `interface IngestEntry { command: string; cwd?: string; exitCode?: number; ts: number; prevCommand?: string }`
  - `createIndex(): CommandIndex`
  - `ingestBlock(index: CommandIndex, e: IngestEntry): void` (mutates)
  - `ingestHistoryLines(index: CommandIndex, lines: string[], ts: number): void`
  - `capIndex(index: CommandIndex, now: number): void`
  - consts `MAX_INDEX_COMMANDS = 2000`, `MAX_CWD_BUCKETS = 8`, `MAX_NEXT_BUCKETS = 8`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/commandIndex.test.ts
import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, ingestHistoryLines, capIndex, MAX_INDEX_COMMANDS } from '@/utils/commandIndex';

describe('commandIndex ingestion', () => {
  it('counts repeated commands and records cwd buckets', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git status', cwd: '/a', ts: 1 });
    ingestBlock(idx, { command: 'git status', cwd: '/a', ts: 2 });
    ingestBlock(idx, { command: 'git status', cwd: '/b', ts: 3 });
    const s = idx.stats['git status'];
    expect(s.count).toBe(3);
    expect(s.lastTs).toBe(3);
    expect(s.cwdCounts['/a']).toBe(2);
    expect(s.cwdCounts['/b']).toBe(1);
  });

  it('records next-command adjacency from prevCommand', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git commit', ts: 2, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git commit', ts: 4, prevCommand: 'git add .' });
    expect(idx.next['git add .']['git commit']).toBe(2);
  });

  it('records lastExitCode', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'false', ts: 1, exitCode: 1 });
    expect(idx.stats['false'].lastExitCode).toBe(1);
  });

  it('ingests history lines with count 1 and no cwd', () => {
    const idx = createIndex();
    ingestHistoryLines(idx, ['ls', 'ls', 'pwd'], 10);
    expect(idx.stats['ls'].count).toBe(2);
    expect(idx.stats['pwd'].count).toBe(1);
    expect(idx.stats['ls'].cwdCounts).toEqual({});
  });

  it('caps total commands to MAX_INDEX_COMMANDS keeping highest count', () => {
    const idx = createIndex();
    for (let i = 0; i < MAX_INDEX_COMMANDS + 50; i++) ingestBlock(idx, { command: `c${i}`, ts: i });
    ingestBlock(idx, { command: 'keep-me', ts: 999999 });
    for (let k = 0; k < 20; k++) ingestBlock(idx, { command: 'keep-me', ts: 999999 });
    capIndex(idx, 1_000_000);
    expect(Object.keys(idx.stats).length).toBeLessThanOrEqual(MAX_INDEX_COMMANDS);
    expect(idx.stats['keep-me']).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- commandIndex`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/commandIndex.ts
export interface CommandStat {
  command: string;
  count: number;
  lastTs: number;
  cwdCounts: Record<string, number>;
  lastExitCode?: number;
}
export interface CommandIndex {
  stats: Record<string, CommandStat>;
  next: Record<string, Record<string, number>>;
}
export interface IngestEntry {
  command: string;
  cwd?: string;
  exitCode?: number;
  ts: number;
  prevCommand?: string;
}

export const MAX_INDEX_COMMANDS = 2000;
export const MAX_CWD_BUCKETS = 8;
export const MAX_NEXT_BUCKETS = 8;

export function createIndex(): CommandIndex {
  return { stats: {}, next: {} };
}

function capBuckets(buckets: Record<string, number>, max: number): void {
  const keys = Object.keys(buckets);
  if (keys.length <= max) return;
  keys.sort((a, b) => buckets[b] - buckets[a]);
  for (const k of keys.slice(max)) delete buckets[k];
}

export function ingestBlock(index: CommandIndex, e: IngestEntry): void {
  const command = e.command.trim();
  if (!command) return;
  const s = index.stats[command] ?? (index.stats[command] = { command, count: 0, lastTs: 0, cwdCounts: {} });
  s.count += 1;
  if (e.ts > s.lastTs) s.lastTs = e.ts;
  if (e.exitCode !== undefined) s.lastExitCode = e.exitCode;
  if (e.cwd) {
    s.cwdCounts[e.cwd] = (s.cwdCounts[e.cwd] ?? 0) + 1;
    capBuckets(s.cwdCounts, MAX_CWD_BUCKETS);
  }
  const prev = e.prevCommand?.trim();
  if (prev) {
    const bucket = index.next[prev] ?? (index.next[prev] = {});
    bucket[command] = (bucket[command] ?? 0) + 1;
    capBuckets(bucket, MAX_NEXT_BUCKETS);
  }
}

export function ingestHistoryLines(index: CommandIndex, lines: string[], ts: number): void {
  for (const line of lines) {
    const command = line.trim();
    if (!command) continue;
    const s = index.stats[command] ?? (index.stats[command] = { command, count: 0, lastTs: 0, cwdCounts: {} });
    s.count += 1;
    if (ts > s.lastTs) s.lastTs = ts;
  }
}

export function capIndex(index: CommandIndex, now: number): void {
  const keys = Object.keys(index.stats);
  if (keys.length <= MAX_INDEX_COMMANDS) return;
  // Evict lowest frecency (count + recency proxy). Cheap proxy here; full
  // frecency lives in Task 2 but cap only needs a stable ordering.
  keys.sort((a, b) => {
    const sa = index.stats[a], sb = index.stats[b];
    return (sb.count + sb.lastTs / now) - (sa.count + sa.lastTs / now);
  });
  for (const k of keys.slice(MAX_INDEX_COMMANDS)) {
    delete index.stats[k];
    delete index.next[k];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- commandIndex`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/commandIndex.ts tests/unit/commandIndex.test.ts
git commit -m "feat(predict): command index structure, ingestion, cap"
```

---

### Task 2: Frecency scoring + prefix ranking + next-command query

**Files:**
- Modify: `src/utils/commandIndex.ts`
- Test: `tests/unit/commandIndexRank.test.ts`

**Interfaces:**
- Consumes: `CommandIndex`, `CommandStat` (Task 1).
- Produces:
  - `frecency(stat: CommandStat, now: number, cwd?: string): number`
  - `rankPrefix(index: CommandIndex, prefix: string, now: number, cwd?: string): string[]` (best first; excludes exact-equal-to-prefix)
  - `topNext(index: CommandIndex, prevCommand: string, n: number): string[]`
  - consts `W_FREQ = 1`, `W_RECENT = 2`, `W_CWD = 1.5`, `HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 7`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/commandIndexRank.test.ts
import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, rankPrefix, topNext, frecency } from '@/utils/commandIndex';

const NOW = 1_000_000_000;

describe('frecency ranking', () => {
  it('ranks a more frequent command above a rarer one for the same prefix', () => {
    const idx = createIndex();
    for (let i = 0; i < 5; i++) ingestBlock(idx, { command: 'git status', ts: NOW - 1000 });
    ingestBlock(idx, { command: 'git stash', ts: NOW - 1000 });
    expect(rankPrefix(idx, 'git st', NOW)[0]).toBe('git status');
  });

  it('cwd boost flips ranking toward the command run in this directory', () => {
    const idx = createIndex();
    for (let i = 0; i < 4; i++) ingestBlock(idx, { command: 'npm run build', ts: NOW - 1000, cwd: '/other' });
    ingestBlock(idx, { command: 'npm run dev', ts: NOW - 1000, cwd: '/proj' });
    ingestBlock(idx, { command: 'npm run dev', ts: NOW - 1000, cwd: '/proj' });
    expect(rankPrefix(idx, 'npm run d', NOW, '/proj')[0]).toBe('npm run dev');
  });

  it('recent beats old at equal frequency', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'make old', ts: NOW - 1000 * 60 * 60 * 24 * 30 });
    ingestBlock(idx, { command: 'make new', ts: NOW - 1000 });
    expect(rankPrefix(idx, 'make', NOW)[0]).toBe('make new');
  });

  it('excludes the command exactly equal to the prefix', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'ls', ts: NOW });
    expect(rankPrefix(idx, 'ls', NOW)).not.toContain('ls');
  });

  it('topNext returns the most common follow-ups', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git commit', ts: 1, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git commit', ts: 2, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git diff', ts: 3, prevCommand: 'git add .' });
    expect(topNext(idx, 'git add .', 2)).toEqual(['git commit', 'git diff']);
  });

  it('frecency is higher for cwd-local commands', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'x', ts: NOW, cwd: '/here' });
    const s = idx.stats['x'];
    expect(frecency(s, NOW, '/here')).toBeGreaterThan(frecency(s, NOW, '/elsewhere'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- commandIndexRank`
Expected: FAIL — `rankPrefix`/`frecency`/`topNext` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/commandIndex.ts`:

```ts
export const W_FREQ = 1;
export const W_RECENT = 2;
export const W_CWD = 1.5;
export const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 7;

export function frecency(stat: CommandStat, now: number, cwd?: string): number {
  const ageMs = Math.max(0, now - stat.lastTs);
  const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS); // 1 → 0 over half-lives
  const cwdHits = cwd ? (stat.cwdCounts[cwd] ?? 0) : 0;
  return (
    W_FREQ * Math.log(stat.count + 1) +
    W_RECENT * recency +
    W_CWD * (cwdHits > 0 ? Math.log(cwdHits + 1) : 0)
  );
}

export function rankPrefix(index: CommandIndex, prefix: string, now: number, cwd?: string): string[] {
  const lower = prefix.toLowerCase();
  if (!lower.trim()) return [];
  const matches: { command: string; score: number }[] = [];
  for (const command in index.stats) {
    const cl = command.toLowerCase();
    if (cl === lower || !cl.startsWith(lower)) continue;
    matches.push({ command, score: frecency(index.stats[command], now, cwd) });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.map((m) => m.command);
}

export function topNext(index: CommandIndex, prevCommand: string, n: number): string[] {
  const bucket = index.next[prevCommand.trim()];
  if (!bucket) return [];
  return Object.keys(bucket).sort((a, b) => bucket[b] - bucket[a]).slice(0, n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- commandIndexRank`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/commandIndex.ts tests/unit/commandIndexRank.test.ts
git commit -m "feat(predict): frecency scoring, prefix ranking, next-command query"
```

---

### Task 3: Persistence store (userData JSON, debounced) + IPC

**Files:**
- Create: `electron/services/commandIndexStore.ts`
- Test: `tests/unit/commandIndexStore.test.ts`
- Modify: `electron/preload.ts`, `src/types/window.d.ts`

**Interfaces:**
- Consumes: `CommandIndex`, `createIndex`, `capIndex` (Tasks 1–2).
- Produces (pure, testable): `serializeIndex(index): string`, `deserializeIndex(raw: string | null, now: number): CommandIndex` (defensive: bad/oversized → fresh index). Plus runtime `loadIndex()`, `scheduleSave(index)`, and IPC handlers `commandIndex:get`, `commandIndex:ingest`, `commandIndex:flush`.
- Renderer IPC: `window.tai.commandIndex.get(): Promise<CommandIndex>`, `.ingest(entries: IngestEntry[]): void`, `.flush(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/commandIndexStore.test.ts
import { describe, it, expect } from 'vitest';
import { serializeIndex, deserializeIndex } from '../../electron/services/commandIndexStore';
import { createIndex, ingestBlock } from '../../src/utils/commandIndex';

describe('commandIndexStore (de)serialize', () => {
  it('round-trips an index', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'ls', cwd: '/a', ts: 5 });
    const back = deserializeIndex(serializeIndex(idx), 100);
    expect(back.stats['ls'].count).toBe(1);
    expect(back.stats['ls'].cwdCounts['/a']).toBe(1);
  });

  it('returns a fresh index for null/garbage/oversized input', () => {
    expect(Object.keys(deserializeIndex(null, 1).stats)).toHaveLength(0);
    expect(Object.keys(deserializeIndex('{not json', 1).stats)).toHaveLength(0);
    expect(Object.keys(deserializeIndex('{"stats":42}', 1).stats)).toHaveLength(0);
  });

  it('caps an oversized deserialized index', () => {
    const idx = createIndex();
    for (let i = 0; i < 5000; i++) ingestBlock(idx, { command: `c${i}`, ts: i });
    const back = deserializeIndex(serializeIndex(idx), 10000);
    expect(Object.keys(back.stats).length).toBeLessThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- commandIndexStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/commandIndexStore.ts
import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  CommandIndex, IngestEntry, createIndex, ingestBlock, capIndex, MAX_INDEX_COMMANDS,
} from '../../src/utils/commandIndex';

const SAVE_DEBOUNCE_MS = 5000;
const indexFile = () => path.join(app.getPath('userData'), 'command-index.json');

export function serializeIndex(index: CommandIndex): string {
  return JSON.stringify(index);
}

export function deserializeIndex(raw: string | null, now: number): CommandIndex {
  if (!raw) return createIndex();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.stats !== 'object' || Array.isArray(parsed.stats) ||
        typeof parsed.next !== 'object') {
      return createIndex();
    }
    const idx: CommandIndex = { stats: parsed.stats, next: parsed.next ?? {} };
    if (Object.keys(idx.stats).length > MAX_INDEX_COMMANDS) capIndex(idx, now);
    return idx;
  } catch {
    return createIndex();
  }
}

let memo: CommandIndex | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadIndex(): CommandIndex {
  if (memo) return memo;
  let raw: string | null = null;
  try { raw = fs.readFileSync(indexFile(), 'utf-8'); } catch { raw = null; }
  memo = deserializeIndex(raw, Date.now());
  return memo;
}

function flushNow(): void {
  if (!memo) return;
  try { fs.writeFileSync(indexFile(), serializeIndex(memo), { mode: 0o600 }); } catch { /* best effort */ }
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; flushNow(); }, SAVE_DEBOUNCE_MS);
}

export function registerCommandIndexIpc(): void {
  ipcMain.handle('commandIndex:get', () => loadIndex());
  ipcMain.on('commandIndex:ingest', (_e, entries: IngestEntry[]) => {
    const idx = loadIndex();
    for (const entry of entries) ingestBlock(idx, entry);
    capIndex(idx, Date.now());
    scheduleSave();
  });
  ipcMain.on('commandIndex:flush', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } flushNow(); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- commandIndexStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire IPC into main + preload + types**

In the main entry (`electron/main.ts`), call `registerCommandIndexIpc()` once after `app.whenReady()` (import it). In `electron/preload.ts`, add under the `tai` object:

```ts
commandIndex: {
  get: () => ipcRenderer.invoke('commandIndex:get'),
  ingest: (entries) => ipcRenderer.send('commandIndex:ingest', entries),
  flush: () => ipcRenderer.send('commandIndex:flush'),
},
```

In `src/types/window.d.ts`, add the matching type to the `tai` interface:

```ts
commandIndex: {
  get: () => Promise<import('@/utils/commandIndex').CommandIndex>;
  ingest: (entries: import('@/utils/commandIndex').IngestEntry[]) => void;
  flush: () => void;
};
```

- [ ] **Step 6: Verify suite + types + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS; build succeeds (the store imports `src/utils/commandIndex` — a pure module — into main; confirm it bundles, like the earlier classifyProviderError cross-boundary import).

- [ ] **Step 7: Commit**

```bash
git add electron/services/commandIndexStore.ts tests/unit/commandIndexStore.test.ts electron/main.ts electron/preload.ts src/types/window.d.ts
git commit -m "feat(predict): persist command index in userData with IPC"
```

---

### Task 4: Ingest blocks at finalize + load index into renderer

**Files:**
- Modify: `src/components/TerminalSession.tsx`

**Interfaces:**
- Consumes: `window.tai.commandIndex.get/ingest`, `CommandIndex`, `IngestEntry`.
- Produces: a `commandIndex` state in `TerminalSession`, refreshed on load and kept current as blocks finalize; passed down to `TerminalInput` (Task 5). Tracks `lastFinalizedCommandRef` to populate `prevCommand`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/commandIngest.test.ts
import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, rankPrefix } from '@/utils/commandIndex';

// Behavioral contract the wiring must satisfy: a finished block becomes a
// ranked, cwd-aware suggestion. (Pure-logic proxy for the wiring.)
describe('block ingestion feeds ghost ranking', () => {
  it('a finalized block in a cwd ranks first for that cwd', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'terraform apply', cwd: '/infra', exitCode: 0, ts: Date.now() });
    expect(rankPrefix(idx, 'terraform a', Date.now(), '/infra')[0]).toBe('terraform apply');
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npm test -- commandIngest`
Expected: PASS immediately (uses only Task 1–2 exports). This task's real verification is the wiring + `tsc` + in-app; this test locks the contract the wiring serves.

- [ ] **Step 3: Wire ingestion + load**

In `TerminalSession.tsx`:
- Add state near `shellHistory` (line ~163): `const [commandIndex, setCommandIndex] = useState(() => createIndex());` and `const lastFinalizedCommandRef = useRef<string | undefined>(undefined);` (import `createIndex`, `ingestBlock`, and types from `@/utils/commandIndex`).
- In the effect that loads shell history (~line 264), also load the index: `window.tai?.commandIndex?.get().then((idx) => idx && setCommandIndex(idx));`
- In `segmenter.onBlock((block) => { ... })` (~line 404), after `fixedBlock` is finalized, ingest it:

```ts
if (fixedBlock.command && fixedBlock.command.trim()) {
  const entry = {
    command: fixedBlock.command,
    cwd: fixedBlock.cwd,
    exitCode: fixedBlock.exitCode,
    ts: fixedBlock.startTime || Date.now(),
    prevCommand: lastFinalizedCommandRef.current,
  };
  lastFinalizedCommandRef.current = fixedBlock.command;
  window.tai?.commandIndex?.ingest([entry]);
  setCommandIndex((prev) => { ingestBlock(prev, entry); return { ...prev }; });
}
```

(Place this where it does not interfere with session-card / AI-suggested handling already at that site.)

- [ ] **Step 4: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalSession.tsx tests/unit/commandIngest.test.ts
git commit -m "feat(predict): ingest finalized blocks into the command index"
```

---

### Task 5: Frecency-aware ghost text in the composer

**Files:**
- Modify: `src/hooks/useGhostText.ts`, `src/components/TerminalInput.tsx`, `src/components/TerminalSession.tsx` (pass props)
- Test: `tests/unit/ghostText.test.ts` (extend existing)

**Interfaces:**
- Consumes: `rankPrefix` (Task 2), `commandIndex` + `cwd` props.
- Produces: `predictCommandIndexed(prefix: string, index: CommandIndex, now: number, cwd?: string): string | null`. The legacy `predictCommand(prefix, history)` stays for back-compat but TerminalInput switches to the indexed predictor.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/ghostText.test.ts
import { predictCommandIndexed } from '@/hooks/useGhostText';
import { createIndex, ingestBlock } from '@/utils/commandIndex';

describe('predictCommandIndexed', () => {
  it('returns the cwd-local frecency winner for a prefix', () => {
    const now = 1_000_000;
    const idx = createIndex();
    for (let i = 0; i < 3; i++) ingestBlock(idx, { command: 'docker compose up', cwd: '/svc', ts: now });
    ingestBlock(idx, { command: 'docker ps', cwd: '/other', ts: now });
    expect(predictCommandIndexed('docker ', idx, now, '/svc')).toBe('docker compose up');
  });
  it('returns null when nothing matches', () => {
    expect(predictCommandIndexed('zzz', createIndex(), 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ghostText`
Expected: FAIL — `predictCommandIndexed` not exported.

- [ ] **Step 3: Implement the indexed predictor**

In `src/hooks/useGhostText.ts` add:

```ts
import { CommandIndex, rankPrefix } from '@/utils/commandIndex';

export function predictCommandIndexed(
  prefix: string, index: CommandIndex, now: number, cwd?: string,
): string | null {
  if (!prefix || !prefix.trim()) return null;
  const ranked = rankPrefix(index, prefix, now, cwd);
  return ranked.length > 0 ? ranked[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ghostText`
Expected: PASS.

- [ ] **Step 5: Wire TerminalInput to the indexed predictor**

In `TerminalInput.tsx`:
- Add props `commandIndex: CommandIndex` and `cwd: string` to the component's props interface (import `CommandIndex`, `predictCommandIndexed`).
- Replace the `prediction` memo (line ~120):

```ts
const prediction = useMemo(
  () => mode === 'shell' && value.length >= GHOST_MIN_PREFIX && !value.includes('\n')
    ? predictCommandIndexed(value, commandIndex, Date.now(), cwd)
    : null,
  [mode, value, commandIndex, cwd],
);
```

- Add `const GHOST_MIN_PREFIX = 2;` near the top of the module (replaces the inline `>= 5`).
- In `TerminalSession.tsx`, pass the new props where `<TerminalInput ... />` is rendered: `commandIndex={commandIndex} cwd={<current tab cwd>}` (use the tab's `cwd` already in scope).

- [ ] **Step 6: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useGhostText.ts src/components/TerminalInput.tsx src/components/TerminalSession.tsx tests/unit/ghostText.test.ts
git commit -m "feat(predict): cwd-aware frecency ghost text"
```

---

**▶ P1 checkpoint:** `npm test && npx tsc --noEmit && npm run build`, then in-app: run `npm run dev` in `/projA` a few times and `npm run test` in `/projB`; in `/projA` type `npm run ` → the dev command (cwd-local) should be the ghost suggestion. Restart the app → suggestions persist (index loaded from userData).

## Self-Review

- **Spec coverage:** Command Index (`commandIndex.ts`) → Tasks 1–2; persistence (`commandIndexStore.ts`, no SQLite, defensive load, debounced) → Task 3; block ingestion at finalize → Task 4; frecency+cwd ghost text replacing `1 + pos/total` and the rigid `>=5` gate → Task 5. The `next` adjacency is built in Task 1 and queried by `topNext` (Task 2) so P2 can consume it.
- **Placeholder scan:** every step has real code; the one cross-boundary import (store → `src/utils`) is build-verified in Task 3 Step 6.
- **Type consistency:** `CommandIndex`/`CommandStat`/`IngestEntry`, `createIndex`/`ingestBlock`/`ingestHistoryLines`/`capIndex`/`frecency`/`rankPrefix`/`topNext`, `predictCommandIndexed`, and the IPC names (`commandIndex:get/ingest/flush`) are each defined once and reused consistently.
