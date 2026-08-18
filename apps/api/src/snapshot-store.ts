import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { ProjectSchema, type Project } from '@cd3/domain';

/** Runtime project data lives outside the repository's tracked tree; `data/` is ignored by Git. */
function dataDirectory(): string {
  return process.env['CD3_DATA_DIR'] ?? fileURLToPath(new URL('../data/', import.meta.url));
}

function snapshotPath(): string {
  return join(dataDirectory(), 'project.c4.json');
}

function historyDirectory(): string {
  return join(dataDirectory(), 'history');
}

/** Keep this many checkpoints, at most one per quiet period. */
const HISTORY_LIMIT = 20;
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

const versionPattern = /^(\d{1,16})\.c4\.json$/;

async function listVersionIds(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(historyDirectory());
  } catch {
    return [];
  }
  return entries
    .map((entry) => versionPattern.exec(entry)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort((left, right) => Number(right) - Number(left));
}

/** Newest first, as millisecond-epoch ids. */
export async function listSnapshotVersions(): Promise<readonly string[]> {
  return listVersionIds();
}

export async function readSnapshotVersion(id: string): Promise<Project | undefined> {
  if (!/^\d{1,16}$/.test(id)) {
    return undefined;
  }
  try {
    const serialized = await readFile(join(historyDirectory(), `${id}.c4.json`), 'utf8');
    const result = ProjectSchema.safeParse(JSON.parse(serialized));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copies the current snapshot into history before it is replaced, at most once per checkpoint
 * interval, and prunes the oldest entries beyond the limit.
 */
async function checkpointCurrentSnapshot(): Promise<void> {
  const versions = await listVersionIds();
  const newest = versions[0];
  const now = Date.now();
  if (newest !== undefined && now - Number(newest) < CHECKPOINT_INTERVAL_MS) {
    return;
  }
  await mkdir(historyDirectory(), { recursive: true });
  try {
    await copyFile(snapshotPath(), join(historyDirectory(), `${String(now)}.c4.json`));
  } catch {
    return; // No current snapshot yet: nothing to checkpoint.
  }
  for (const stale of versions.slice(HISTORY_LIMIT - 1)) {
    await unlink(join(historyDirectory(), `${stale}.c4.json`)).catch(() => undefined);
  }
}

/** Forgets the stored snapshot and its history; a reset must not be undone by the next load. */
export async function deleteSnapshot(): Promise<void> {
  await rm(snapshotPath(), { force: true });
  await rm(historyDirectory(), { force: true, recursive: true });
}

/**
 * One writer at a time. Every read-check-write span goes through this chain, so a guard can never
 * pass against a snapshot another writer is mid-way through replacing, and the shared temporary
 * file is never written concurrently. Rejections do not poison the chain.
 */
let writeChain: Promise<void> = Promise.resolve();

export function withSnapshotLock<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface StoredSnapshot {
  readonly project: Project;
  /** Content hash of the stored bytes; identical content always yields the identical revision. */
  readonly revision: string;
}

function revisionOf(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

/** Reads the stored snapshot, or undefined when nothing has been saved yet. */
export async function readSnapshot(): Promise<StoredSnapshot | undefined> {
  // A snapshot that is unreadable, not JSON, or no longer valid against the schema is treated as
  // absent rather than served: clients fall back instead of receiving something the domain rejects.
  try {
    const serialized = await readFile(snapshotPath(), 'utf8');
    const result = ProjectSchema.safeParse(JSON.parse(serialized));
    return result.success ? { project: result.data, revision: revisionOf(serialized) } : undefined;
  } catch {
    return undefined;
  }
}

/** The current revision alone; absent exactly when readSnapshot would treat the file as absent. */
export async function readSnapshotRevision(): Promise<string | undefined> {
  return (await readSnapshot())?.revision;
}

/**
 * Validates and stores a snapshot. The write goes to a sibling temporary file and is renamed into
 * place, so a crash mid-write leaves the previous snapshot intact rather than a truncated one.
 */
export async function writeSnapshot(candidate: unknown): Promise<StoredSnapshot> {
  const result = ProjectSchema.safeParse(candidate);
  if (!result.success) {
    throw new TypeError(result.error.issues.map((issue) => issue.message).join('; '));
  }

  const directory = dataDirectory();
  await mkdir(directory, { recursive: true });
  await checkpointCurrentSnapshot();
  const target = snapshotPath();
  const temporary = `${target}.tmp`;
  const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
  await writeFile(temporary, serialized, 'utf8');
  await rename(temporary, target);
  return { project: result.data, revision: revisionOf(serialized) };
}
