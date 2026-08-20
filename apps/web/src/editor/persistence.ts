import { ProjectSchema, type ReadonlyProject } from '@cd3/domain';

const STORAGE_KEY = 'cd3.project.v1';
const CONFLICT_KEY = 'cd3.project.conflict.v1';
const ACKNOWLEDGMENT_KEY = 'cd3.project.ack.v1';
const SNAPSHOT_URL = '/api/project';
const LOCAL_FORMAT_VERSION = 2;

/** Where the current project came from, and where the last save reached. */
export type ProjectSource = 'browser' | 'disk' | 'sample';
export type SaveOutcome = 'browser' | 'conflict' | 'disk' | 'failed';
export type ResetOutcome = 'browser-failed' | 'disk-failed' | 'forgotten';

export type RemoteResult<Value> =
  | { readonly status: 'absent' }
  | { readonly status: 'found'; readonly value: Value }
  | { readonly status: 'unreachable' };

interface LocalSnapshot {
  readonly baseRevision: string | null;
  readonly changeId: string;
  readonly formatVersion: typeof LOCAL_FORMAT_VERSION;
  readonly project: ReadonlyProject;
  readonly state: 'dirty' | 'synced';
  readonly updatedAt: number;
}

interface RemoteProject {
  readonly project: ReadonlyProject;
  readonly revision: string;
}

interface LocalAcknowledgment {
  readonly changeId: string;
  readonly revision: string;
}

/**
 * Revision of the disk snapshot this tab last adopted or wrote. Saves state it as If-Match so the
 * app cannot clobber a change made outside it.
 */
let knownRemoteRevision: string | undefined;
let localChangeSequence = 0;
let persistencePaused = false;
let remoteSaveTail: Promise<void> = Promise.resolve();
// localStorage is shared by tabs. This id prevents one tab from advancing another tab's dirty
// snapshot to a revision it was not based on when their saves overlap.
const persistenceSessionId = crypto.randomUUID();

export function remoteRevision(): string | undefined {
  return knownRemoteRevision;
}

function parseProject(candidate: unknown): ReadonlyProject | undefined {
  const result = ProjectSchema.safeParse(candidate);
  // A snapshot written by an older schema is ignored rather than repaired: the caller falls back
  // instead of loading something the domain would reject on the first command.
  return result.success ? result.data : undefined;
}

function parseLocalSnapshot(serialized: string): LocalSnapshot | undefined {
  const candidate: unknown = JSON.parse(serialized);
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'formatVersion' in candidate &&
    candidate.formatVersion === LOCAL_FORMAT_VERSION &&
    'project' in candidate &&
    'state' in candidate &&
    (candidate.state === 'dirty' || candidate.state === 'synced') &&
    'baseRevision' in candidate &&
    (candidate.baseRevision === null || typeof candidate.baseRevision === 'string') &&
    'changeId' in candidate &&
    typeof candidate.changeId === 'string' &&
    'updatedAt' in candidate &&
    typeof candidate.updatedAt === 'number'
  ) {
    const project = parseProject(candidate.project);
    return project === undefined
      ? undefined
      : {
          baseRevision: candidate.baseRevision,
          changeId: candidate.changeId,
          formatVersion: LOCAL_FORMAT_VERSION,
          project,
          state: candidate.state,
          updatedAt: candidate.updatedAt,
        };
  }

  // Version 1 stored the project directly. Its sync state is unknowable, so treat it as dirty: a
  // conflict is recoverable, while declaring it synced could silently discard the only new copy.
  const project = parseProject(candidate);
  return project === undefined
    ? undefined
    : {
        baseRevision: null,
        changeId: 'legacy',
        formatVersion: LOCAL_FORMAT_VERSION,
        project,
        state: 'dirty',
        updatedAt: 0,
      };
}

function readLocalAcknowledgment(): LocalAcknowledgment | undefined {
  try {
    const serialized = localStorage.getItem(ACKNOWLEDGMENT_KEY);
    if (serialized === null) {
      return undefined;
    }
    const candidate: unknown = JSON.parse(serialized);
    return typeof candidate === 'object' &&
      candidate !== null &&
      'changeId' in candidate &&
      typeof candidate.changeId === 'string' &&
      'revision' in candidate &&
      typeof candidate.revision === 'string'
      ? { changeId: candidate.changeId, revision: candidate.revision }
      : undefined;
  } catch {
    return undefined;
  }
}

function readLocalSnapshot(): LocalSnapshot | undefined {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    const snapshot = serialized === null ? undefined : parseLocalSnapshot(serialized);
    if (snapshot?.state !== 'dirty') {
      return snapshot;
    }
    const acknowledgment = readLocalAcknowledgment();
    return acknowledgment?.changeId === snapshot.changeId
      ? { ...snapshot, baseRevision: acknowledgment.revision, state: 'synced' }
      : snapshot;
  } catch {
    return undefined;
  }
}

function writeLocalSnapshot(snapshot: LocalSnapshot): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function acknowledgeLocalSave(changeId: string, revision: string): void {
  try {
    // Keep the acknowledgment separate from the shared project key. Another renderer can replace
    // the project at any instant; writing only metadata means this tab can never overwrite that
    // newer dirty project while marking its own completed save.
    localStorage.setItem(ACKNOWLEDGMENT_KEY, JSON.stringify({ changeId, revision }));
  } catch {
    // Disk is already durable. A missing acknowledgment can only cause a recoverable false conflict
    // on the next launch; it must not downgrade the successful disk save.
  }
}

function nextChangeId(): string {
  localChangeSequence += 1;
  return `${persistenceSessionId}:${String(Date.now())}:${String(localChangeSequence)}`;
}

export function readLocalProject(): ReadonlyProject | undefined {
  return readLocalSnapshot()?.project;
}

/** Atomically records an edit as dirty before any debounced or network work begins. */
function stageLocalProject(project: ReadonlyProject): string | undefined {
  if (persistencePaused) {
    return undefined;
  }
  const changeId = nextChangeId();
  return writeLocalSnapshot({
    baseRevision: knownRemoteRevision ?? null,
    changeId,
    formatVersion: LOCAL_FORMAT_VERSION,
    project,
    state: 'dirty',
    updatedAt: Date.now(),
  })
    ? changeId
    : undefined;
}

export function writeLocalProject(project: ReadonlyProject): boolean {
  return stageLocalProject(project) !== undefined;
}

export function clearLocalProject(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Reads and validates the disk snapshot while preserving absent vs unavailable. */
export async function readRemoteProject(): Promise<RemoteResult<RemoteProject>> {
  try {
    const response = await fetch(SNAPSHOT_URL);
    if (response.status === 404) {
      return { status: 'absent' };
    }
    if (!response.ok) {
      return { status: 'unreachable' };
    }
    const project = parseProject(await response.json());
    const revision = response.headers.get('etag');
    if (project === undefined || revision === null || revision === '') {
      return { status: 'unreachable' };
    }
    return { status: 'found', value: { project, revision } };
  } catch {
    return { status: 'unreachable' };
  }
}

/** Reads the disk revision while preserving absent vs unavailable. */
export async function fetchRemoteRevision(): Promise<RemoteResult<string>> {
  try {
    const response = await fetch(`${SNAPSHOT_URL}/revision`);
    if (response.status === 404) {
      return { status: 'absent' };
    }
    if (!response.ok) {
      return { status: 'unreachable' };
    }
    const body: unknown = await response.json();
    return typeof body === 'object' &&
      body !== null &&
      'revision' in body &&
      typeof body.revision === 'string' &&
      body.revision !== ''
      ? { status: 'found', value: body.revision }
      : { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}

async function writeRemoteProject(
  project: ReadonlyProject,
): Promise<
  | { readonly revision: string; readonly status: 'saved' }
  | { readonly status: 'conflict' | 'unreachable' }
> {
  let precondition: Readonly<Record<string, string>>;
  const baseRevision = knownRemoteRevision;

  if (baseRevision === undefined) {
    // A failed revision request is not evidence that the snapshot is absent. Only an explicit 404
    // permits a create, and If-None-Match closes the race between this check and the PUT.
    const existing = await fetchRemoteRevision();
    if (existing.status === 'found') {
      return { status: 'conflict' };
    }
    if (existing.status === 'unreachable') {
      return { status: 'unreachable' };
    }
    precondition = { 'if-none-match': '*' };
  } else {
    precondition = { 'if-match': baseRevision };
  }

  try {
    const response = await fetch(SNAPSHOT_URL, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...precondition,
      },
      body: JSON.stringify(project),
    });
    if (response.status === 409 || response.status === 412) {
      return { status: 'conflict' };
    }
    if (!response.ok) {
      return { status: 'unreachable' };
    }
    const revision = response.headers.get('etag');
    if (revision === null || revision === '') {
      return { status: 'unreachable' };
    }
    knownRemoteRevision = revision;
    return { revision, status: 'saved' };
  } catch {
    return { status: 'unreachable' };
  }
}

function enqueueRemoteSave<Result>(work: () => Promise<Result>): Promise<Result> {
  const result = remoteSaveTail.then(work, work);
  remoteSaveTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Dirty browser state wins on startup. A synced browser cache yields to disk, and sample is the
 * final fallback. Browser/sample results are staged immediately so closing before React mounts
 * still cannot lose the selected recovery copy.
 */
export async function loadProject(
  sample: ReadonlyProject,
): Promise<{ readonly project: ReadonlyProject; readonly source: ProjectSource }> {
  persistencePaused = false;
  knownRemoteRevision = undefined;
  const local = readLocalSnapshot();
  const remote = await readRemoteProject();

  if (local?.state === 'dirty') {
    const recovery = readConflictProject();
    if (
      remote.status === 'found' &&
      recovery !== undefined &&
      JSON.stringify(recovery) === JSON.stringify(local.project)
    ) {
      // This dirty primary was already preserved during a previous conflict adoption. Open disk;
      // the recovery menu remains the explicit path back to the losing copy.
      knownRemoteRevision = remote.value.revision;
      return { project: remote.value.project, source: 'disk' };
    }
    // The old format had no dirty bit. Avoid manufacturing a recovery conflict when that legacy
    // browser value is byte-for-byte the same validated project as the current disk snapshot.
    if (
      local.changeId === 'legacy' &&
      remote.status === 'found' &&
      JSON.stringify(local.project) === JSON.stringify(remote.value.project)
    ) {
      knownRemoteRevision = remote.value.revision;
      return { project: remote.value.project, source: 'disk' };
    }
    // Keep the revision on which the local edit was based, so its next write conflicts instead of
    // overwriting a newer disk snapshot that happened to be observed during startup.
    knownRemoteRevision = local.baseRevision ?? undefined;
    return { project: local.project, source: 'browser' };
  }

  if (remote.status === 'found') {
    knownRemoteRevision = remote.value.revision;
    return { project: remote.value.project, source: 'disk' };
  }

  if (local !== undefined) {
    knownRemoteRevision = local.baseRevision ?? undefined;
    // This copy still needs to seed/reconnect to disk, so make that obligation durable now.
    writeLocalProject(local.project);
    return { project: local.project, source: 'browser' };
  }

  writeLocalProject(sample);
  return { project: sample, source: 'sample' };
}

/**
 * Writes browser storage synchronously, then serializes the guarded disk write. The browser copy
 * remains dirty until that exact changeId is confirmed on disk.
 */
export function saveProject(project: ReadonlyProject): Promise<SaveOutcome> {
  if (persistencePaused) {
    return Promise.resolve('failed');
  }
  const changeId = stageLocalProject(project);
  const local = changeId !== undefined;

  return enqueueRemoteSave(async () => {
    if (persistencePaused) {
      return local ? 'browser' : 'failed';
    }
    const remote = await writeRemoteProject(project);
    if (remote.status === 'saved') {
      if (changeId !== undefined) {
        acknowledgeLocalSave(changeId, remote.revision);
      }
      return 'disk';
    }
    if (remote.status === 'conflict') {
      // The editor may only yield to the external snapshot after this losing copy is durable. If
      // recovery storage is unavailable, report a hard failure so remote sync keeps the in-memory
      // project open instead of silently replacing the user's only remaining copy.
      return stashConflictProject(project) ? 'conflict' : 'failed';
    }
    return local ? 'browser' : 'failed';
  });
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
    const response = await fetch(`${SNAPSHOT_URL}/history/${encodeURIComponent(id)}`);
    return response.ok ? parseProject(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a copy that lost a conflict until the user downloads or explicitly resets it. */
export function stashConflictProject(project: ReadonlyProject): boolean {
  try {
    localStorage.setItem(CONFLICT_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function readConflictProject(): ReadonlyProject | undefined {
  try {
    const serialized = localStorage.getItem(CONFLICT_KEY);
    return serialized === null ? undefined : parseProject(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}

function clearAllLocalCopies(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONFLICT_KEY);
    localStorage.removeItem(ACKNOWLEDGMENT_KEY);
    return (
      localStorage.getItem(STORAGE_KEY) === null &&
      localStorage.getItem(CONFLICT_KEY) === null &&
      localStorage.getItem(ACKNOWLEDGMENT_KEY) === null
    );
  } catch {
    return false;
  }
}

/**
 * Pauses new saves, drains older ones, deletes disk, and only then clears both browser copies.
 * Failure leaves the recoverable browser project in place and is reported to the caller.
 */
export async function forgetProject(): Promise<ResetOutcome> {
  if (persistencePaused) {
    return 'disk-failed';
  }
  persistencePaused = true;
  await remoteSaveTail;

  const remote = await fetchRemoteRevision();
  if (remote.status === 'unreachable') {
    persistencePaused = false;
    return 'disk-failed';
  }

  try {
    if (remote.status === 'found') {
      // Resolve the target after pending saves drain, then guard deletion against an external write
      // landing between this revision read and DELETE.
      const response = await fetch(SNAPSHOT_URL, {
        method: 'DELETE',
        headers: { 'if-match': remote.value },
      });
      if (!response.ok) {
        persistencePaused = false;
        return 'disk-failed';
      }
    }
  } catch {
    persistencePaused = false;
    return 'disk-failed';
  }

  knownRemoteRevision = undefined;
  if (clearAllLocalCopies()) {
    return 'forgotten';
  }
  // Reset did not complete. Let subsequent edits become durable again instead of leaving the open
  // editor in a permanent paused state after the user dismisses the error.
  persistencePaused = false;
  return 'browser-failed';
}

/** Called after an externally-read project has replaced the editor state. */
export function adoptRemoteRevision(revision: string): void {
  knownRemoteRevision = revision;
}
