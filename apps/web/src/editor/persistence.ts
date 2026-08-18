import { ProjectSchema, type ReadonlyProject } from '@cd3/domain';

const STORAGE_KEY = 'cd3.project.v1';
const SNAPSHOT_URL = '/api/project';

/** Where the current project came from, and where the last save reached. */
export type ProjectSource = 'browser' | 'disk' | 'sample';
export type SaveOutcome = 'browser' | 'disk' | 'failed';

function parseProject(candidate: unknown): ReadonlyProject | undefined {
  const result = ProjectSchema.safeParse(candidate);
  // A snapshot written by an older schema is ignored rather than repaired: the caller falls back to
  // the sample project instead of loading something the domain would reject on the first command.
  return result.success ? result.data : undefined;
}

export function readLocalProject(): ReadonlyProject | undefined {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    return serialized === null ? undefined : parseProject(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}

export function writeLocalProject(project: ReadonlyProject): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export async function readRemoteProject(): Promise<ReadonlyProject | undefined> {
  try {
    const response = await fetch(SNAPSHOT_URL);
    return response.ok ? parseProject(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeRemoteProject(project: ReadonlyProject): Promise<boolean> {
  try {
    const response = await fetch(SNAPSHOT_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(project),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Disk wins over the browser copy, and the sample project is the last resort. */
export async function loadProject(
  sample: ReadonlyProject,
): Promise<{ readonly project: ReadonlyProject; readonly source: ProjectSource }> {
  const remote = await readRemoteProject();
  if (remote !== undefined) {
    return { project: remote, source: 'disk' };
  }
  const local = readLocalProject();
  if (local !== undefined) {
    return { project: local, source: 'browser' };
  }
  return { project: sample, source: 'sample' };
}

/**
 * Saves to the browser first because it cannot fail on a cold API, then tries the loopback service.
 * The returned value is the furthest the project actually reached.
 */
export async function saveProject(project: ReadonlyProject): Promise<SaveOutcome> {
  const local = writeLocalProject(project);
  const remote = await writeRemoteProject(project);
  return remote ? 'disk' : local ? 'browser' : 'failed';
}

/** Millisecond-epoch ids of the disk checkpoints, newest first. */
export async function listRemoteVersions(): Promise<readonly string[]> {
  try {
    const response = await fetch(`${SNAPSHOT_URL}/history`);
    if (!response.ok) {
      return [];
    }
    const body: unknown = await response.json();
    const versions =
      typeof body === 'object' && body !== null && 'versions' in body ? body.versions : undefined;
    return Array.isArray(versions)
      ? versions.filter((version): version is string => typeof version === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function readRemoteVersion(id: string): Promise<ReadonlyProject | undefined> {
  try {
    const response = await fetch(`${SNAPSHOT_URL}/history/${id}`);
    return response.ok ? parseProject(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** Forgets every stored copy, so the next load falls back to the sample project. */
export async function forgetProject(): Promise<void> {
  clearLocalProject();
  try {
    await fetch(SNAPSHOT_URL, { method: 'DELETE' });
  } catch {
    // The browser copy is gone either way; a missing API just leaves the disk snapshot behind.
  }
}
