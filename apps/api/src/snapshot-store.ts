import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

/** Forgets the stored snapshot; a workspace reset must not be undone by the next load. */
export async function deleteSnapshot(): Promise<void> {
  await rm(snapshotPath(), { force: true });
}

/** Reads the stored snapshot, or undefined when nothing has been saved yet. */
export async function readSnapshot(): Promise<Project | undefined> {
  let serialized: string;
  try {
    serialized = await readFile(snapshotPath(), 'utf8');
  } catch {
    return undefined;
  }
  const result = ProjectSchema.safeParse(JSON.parse(serialized));
  // A snapshot that no longer satisfies the schema is treated as absent rather than served: the
  // client falls back to its own copy instead of loading a project the domain would reject.
  return result.success ? result.data : undefined;
}

/**
 * Validates and stores a snapshot. The write goes to a sibling temporary file and is renamed into
 * place, so a crash mid-write leaves the previous snapshot intact rather than a truncated one.
 */
export async function writeSnapshot(candidate: unknown): Promise<Project> {
  const result = ProjectSchema.safeParse(candidate);
  if (!result.success) {
    throw new TypeError(result.error.issues.map((issue) => issue.message).join('; '));
  }

  const directory = dataDirectory();
  await mkdir(directory, { recursive: true });
  const target = snapshotPath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return result.data;
}
