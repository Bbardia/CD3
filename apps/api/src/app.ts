import { existsSync } from 'node:fs';

import fastifyStatic from '@fastify/static';
import { applyCommands, DomainCommandError, type DomainCommand } from '@cd3/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import {
  deleteSnapshot,
  listSnapshotVersions,
  readSnapshotState,
  readSnapshotVersion,
  withSnapshotLock,
  writeSnapshot,
} from './snapshot-store.js';

/**
 * Structural ceiling for request bodies, checked iteratively before any recursive machinery
 * (structuredClone, zod) can hit the call stack: the schema allows 8 levels of JSON properties,
 * plus wrapper levels, with generous headroom.
 */
const MAX_BODY_DEPTH = 32;

function bodyTooDeep(root: unknown): boolean {
  let level: readonly unknown[] = [root];
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth > MAX_BODY_DEPTH) {
      return true;
    }
    const next: unknown[] = [];
    for (const value of level) {
      if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
          next.push((value as Record<string, unknown>)[key]);
        }
      }
    }
    level = next;
  }
  return false;
}

/** One command or a batch; a batch is atomic — either every command lands or none do. */
function commandsOf(body: unknown): readonly unknown[] | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  if ('commands' in body && Array.isArray(body.commands)) {
    return body.commands.length >= 1 && body.commands.length <= 100 ? body.commands : undefined;
  }
  if ('command' in body && typeof body.command === 'object' && body.command !== null) {
    return [body.command];
  }
  return undefined;
}

/** Finds which command a failed batch died on, applying prefixes until one fails. */
function failingIndex(
  project: Parameters<typeof applyCommands>[0],
  commands: readonly DomainCommand[],
): number {
  for (const [index] of commands.entries()) {
    try {
      applyCommands(project, commands.slice(0, index + 1));
    } catch {
      return index;
    }
  }
  return commands.length - 1;
}

function baseRevisionOf(body: unknown): string | undefined {
  return typeof body === 'object' &&
    body !== null &&
    'baseRevision' in body &&
    typeof body.baseRevision === 'string'
    ? body.baseRevision
    : undefined;
}

interface RevisionTag {
  readonly revision: string;
  readonly weak: boolean;
}

type RevisionCondition =
  | { readonly kind: 'any-current' }
  | { readonly kind: 'revisions'; readonly tags: readonly RevisionTag[] };

/**
 * Accepts both standards-shaped entity tags (`"revision"`) and the unquoted revision tokens the
 * existing app sends. Supporting lists costs little and keeps the precondition behavior predictable
 * for scripting clients.
 */
function revisionConditionOf(
  value: string | readonly string[] | undefined,
): RevisionCondition | 'invalid' | undefined {
  if (value === undefined) {
    return undefined;
  }
  const candidates = (typeof value === 'string' ? value : value.join(','))
    .split(',')
    .map((candidate) => candidate.trim());
  if (candidates.length === 0 || candidates.some((candidate) => candidate === '')) {
    return 'invalid';
  }
  if (candidates.includes('*')) {
    return candidates.length === 1 ? { kind: 'any-current' } : 'invalid';
  }

  const tags: RevisionTag[] = [];
  for (const rawCandidate of candidates) {
    const weak = rawCandidate.startsWith('W/');
    const candidate = weak ? rawCandidate.slice(2) : rawCandidate;
    if (candidate === '' || (weak && candidate === '*')) {
      return 'invalid';
    }
    const quoted = candidate.startsWith('"') || candidate.endsWith('"');
    if (quoted) {
      if (
        candidate.length < 2 ||
        !candidate.startsWith('"') ||
        !candidate.endsWith('"') ||
        candidate.slice(1, -1).includes('"')
      ) {
        return 'invalid';
      }
      tags.push({ revision: candidate.slice(1, -1), weak });
    } else {
      // Bare values are a compatibility affordance, but whitespace/control characters are never
      // valid revision tokens and make intermediary parsing ambiguous.
      if (
        [...candidate].some((character) => {
          const code = character.charCodeAt(0);
          return /\s/.test(character) || code <= 31 || code === 127;
        })
      ) {
        return 'invalid';
      }
      tags.push({ revision: candidate, weak });
    }
  }
  return { kind: 'revisions', tags };
}

function conditionMatches(
  condition: RevisionCondition,
  current: string | undefined,
  currentExists: boolean,
  weakComparison: boolean,
): boolean {
  if (condition.kind === 'any-current') {
    return currentExists;
  }
  if (current === undefined) {
    return false;
  }
  return condition.tags.some((tag) => tag.revision === current && (weakComparison || !tag.weak));
}

function revisionConflict(reply: FastifyReply, error: string, current: string | undefined) {
  if (current !== undefined) {
    reply.header('etag', current);
  }
  return reply.code(409).send({
    code: 'REVISION_CONFLICT',
    error,
    // Null means the existing state has no usable current revision (missing or invalid on disk).
    revision: current ?? null,
  });
}

function invalidRevisionHeader(reply: FastifyReply, name: 'If-Match' | 'If-None-Match') {
  return reply.code(400).send({
    error: `${name} must be * or a comma-separated list of revision entity tags.`,
  });
}

function invalidStoredSnapshot(reply: FastifyReply) {
  return reply.code(500).send({
    code: 'SNAPSHOT_INVALID',
    error:
      'The stored project exists but is unreadable or invalid. Replace it with an unguarded PUT or delete it explicitly.',
  });
}

function isLoopbackAuthority(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const match = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/i.exec(value);
  if (match === null) {
    return false;
  }
  const port = match[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

/** The host:port part of an origin, or of a bare authority written without a scheme. */
function authorityOf(value: string): string {
  return (/^https?:\/\/(.+)$/i.exec(value)?.[1] ?? value).replace(/\/+$/, '').toLowerCase();
}

/**
 * Extra authorities this instance answers to, from CD3_PUBLIC_ORIGIN — the address people type in
 * their browser when CD3 is hosted on a shared machine. Comma-separated for several names, or `*`
 * when the address is not known ahead of time. Unset means loopback only.
 */
export function publicAuthorities(): 'any' | readonly string[] {
  const raw = process.env['CD3_PUBLIC_ORIGIN'];
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const entries = raw
    .split(',')
    .map((entry) => authorityOf(entry.trim()))
    .filter((entry) => entry !== '');
  return entries.includes('*') ? 'any' : entries;
}

/**
 * Everything the app needs is served from this origin: its own bundle, its own worker, its own
 * font. `data:`/`blob:` images cover the PNG export round-trip, and inline styles are how React,
 * React Flow and drei position their nodes. A header, not a meta tag, so it also states
 * frame-ancestors — and so the dev server's inline HMR preamble is left alone.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MUTATING_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

export function buildServer(): FastifyInstance {
  const server = Fastify({
    // A generated project of a few hundred elements serialises well under a megabyte, but the
    // default 1 MB body limit leaves no headroom for descriptions and properties.
    bodyLimit: 8 * 1024 * 1024,
    logger: process.env.NODE_ENV !== 'test',
  });

  // Binding to 127.0.0.1 alone does not stop DNS rebinding: an attacker-controlled hostname can
  // resolve to loopback and become same-origin with this API. Answer only to loopback and to the
  // authorities the operator published, and reject browser mutations that are not same-origin with
  // the address they were sent to — which holds behind a TLS proxy, where only the scheme differs.
  const allowed = publicAuthorities();
  const hostIsAllowed = (host: string | undefined): boolean =>
    isLoopbackAuthority(host) ||
    allowed === 'any' ||
    (host !== undefined && allowed.includes(host.toLowerCase()));

  server.addHook('onRequest', async (request, reply) => {
    if (!hostIsAllowed(request.headers.host)) {
      return reply
        .code(403)
        .send({ error: 'CD3 does not answer to that hostname. See CD3_PUBLIC_ORIGIN.' });
    }
    const origin = request.headers.origin;
    if (
      request.url.startsWith('/api/') &&
      MUTATING_METHODS.has(request.method) &&
      origin !== undefined &&
      authorityOf(origin) !== (request.headers.host ?? '').toLowerCase() &&
      !(isLoopbackAuthority(authorityOf(origin)) && isLoopbackAuthority(request.headers.host))
    ) {
      return reply.code(403).send({ error: 'Cross-origin API mutations are not allowed.' });
    }
  });

  // Project state is mutable and revision-polled. Never let a browser or intermediary satisfy an
  // API read from a stale cache, and prevent MIME sniffing on both JSON and static responses.
  server.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('referrer-policy', 'no-referrer');
    if (request.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  // Production mode: when a built web app is present, this server is the whole application.
  const webDist = process.env['CD3_WEB_DIST'];
  if (webDist !== undefined && existsSync(webDist)) {
    void server.register(fastifyStatic, { root: webDist });
    server.setNotFoundHandler(async (request, reply) => {
      // The SPA owns every non-API route; unknown API routes stay honest 404s.
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: `Route ${request.url} does not exist.` });
      }
      return reply.sendFile('index.html');
    });
  }

  server.get('/api/health', async () => ({
    schemaVersion: 1,
    service: '@cd3/api',
    status: 'ok',
  }));

  server.get('/api/project', async (_request, reply) => {
    const state = await readSnapshotState();
    if (state.status === 'absent') {
      return reply.code(404).send({ error: 'No project snapshot has been saved yet.' });
    }
    if (state.status === 'invalid') {
      return invalidStoredSnapshot(reply);
    }
    const stored = state.snapshot;
    return reply.header('etag', stored.revision).send(stored.project);
  });

  server.get('/api/project/revision', async (_request, reply) => {
    const state = await readSnapshotState();
    if (state.status === 'absent') {
      return reply.code(404).send({ error: 'No project snapshot has been saved yet.' });
    }
    if (state.status === 'invalid') {
      return invalidStoredSnapshot(reply);
    }
    return { revision: state.snapshot.revision };
  });

  server.put('/api/project', async (request, reply) => {
    if (bodyTooDeep(request.body)) {
      return reply
        .code(400)
        .send({ error: `Project is invalid: nesting exceeds ${String(MAX_BODY_DEPTH)} levels.` });
    }
    const ifMatch = revisionConditionOf(request.headers['if-match']);
    if (ifMatch === 'invalid') {
      return invalidRevisionHeader(reply, 'If-Match');
    }
    const ifNoneMatch = revisionConditionOf(request.headers['if-none-match']);
    if (ifNoneMatch === 'invalid') {
      return invalidRevisionHeader(reply, 'If-None-Match');
    }
    // The guard and the write happen under one lock, so a writer that states where it started from
    // can never interleave with another writer and clobber a snapshot it did not read.
    return withSnapshotLock(async () => {
      const state =
        ifMatch === undefined && ifNoneMatch === undefined ? undefined : await readSnapshotState();
      const current = state?.status === 'found' ? state.snapshot.revision : undefined;
      const currentExists = state !== undefined && state.status !== 'absent';
      if (ifMatch !== undefined && !conditionMatches(ifMatch, current, currentExists, false)) {
        return revisionConflict(
          reply,
          state?.status === 'invalid'
            ? 'The stored project exists but has no valid revision. Replace or delete it explicitly.'
            : current === undefined
              ? 'The stored project was deleted since this copy was read.'
              : 'The stored project changed since this copy was read.',
          current,
        );
      }
      // If-None-Match uses weak comparison. Most importantly, `*` is an atomic create-only guard:
      // two first-time writers enter this lock in turn, and only the first observes no snapshot.
      if (
        ifNoneMatch !== undefined &&
        conditionMatches(ifNoneMatch, current, currentExists, true)
      ) {
        return revisionConflict(reply, 'A project snapshot already exists.', current);
      }
      try {
        const stored = await writeSnapshot(request.body);
        return reply
          .code(200)
          .header('etag', stored.revision)
          .send({ id: stored.project.id, status: 'saved', revision: stored.revision });
      } catch (error) {
        if (error instanceof TypeError) {
          return reply.code(400).send({ error: `Project is invalid: ${error.message}` });
        }
        throw error;
      }
    });
  });

  server.post('/api/commands', async (request, reply) => {
    if (bodyTooDeep(request.body)) {
      return reply
        .code(400)
        .send({ error: `Command body nesting exceeds ${String(MAX_BODY_DEPTH)} levels.` });
    }
    const commands = commandsOf(request.body);
    if (commands === undefined) {
      return reply.code(400).send({
        error: 'Send { command: {...} } or { commands: [...] } with 1 to 100 domain commands.',
      });
    }
    return withSnapshotLock(async () => {
      const state = await readSnapshotState();
      if (state.status === 'absent') {
        return revisionConflict(
          reply,
          'No project snapshot to edit. Save one first: open the app or PUT /api/project.',
          undefined,
        );
      }
      if (state.status === 'invalid') {
        return invalidStoredSnapshot(reply);
      }
      const stored = state.snapshot;
      const baseRevision = baseRevisionOf(request.body);
      if (baseRevision !== undefined && baseRevision !== stored.revision) {
        return revisionConflict(
          reply,
          'The stored project changed since baseRevision was read.',
          stored.revision,
        );
      }

      // One validation boundary for the whole batch; a failure reports its position and nothing
      // is persisted. DomainCommandError does not say which command failed, so locate it by
      // bisection-free re-application only when the cheap single pass fails.
      try {
        const { project } = applyCommands(stored.project, commands as readonly DomainCommand[]);
        const written = await writeSnapshot(project);
        return reply
          .header('etag', written.revision)
          .send({ applied: commands.length, revision: written.revision });
      } catch (error) {
        if (error instanceof DomainCommandError) {
          return reply.code(400).send({
            error: error.message,
            code: error.code,
            failedAt: failingIndex(stored.project, commands as readonly DomainCommand[]),
            revision: stored.revision,
          });
        }
        throw error;
      }
    });
  });

  server.get('/api/project/history', async () => ({ versions: await listSnapshotVersions() }));

  server.get('/api/project/history/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const snapshot = await readSnapshotVersion(id);
    if (snapshot === undefined) {
      return reply.code(404).send({ error: `Version "${id}" does not exist.` });
    }
    return snapshot;
  });

  server.delete('/api/project', async (request, reply) => {
    const ifMatch = revisionConditionOf(request.headers['if-match']);
    if (ifMatch === 'invalid') {
      return invalidRevisionHeader(reply, 'If-Match');
    }
    return withSnapshotLock(async () => {
      if (ifMatch !== undefined) {
        const state = await readSnapshotState();
        const current = state.status === 'found' ? state.snapshot.revision : undefined;
        if (!conditionMatches(ifMatch, current, state.status !== 'absent', false)) {
          return revisionConflict(
            reply,
            state.status === 'invalid'
              ? 'The stored project exists but has no valid revision. Delete it explicitly.'
              : current === undefined
                ? 'The project snapshot was already deleted.'
                : 'The stored project changed since this delete was requested.',
            current,
          );
        }
      }
      await deleteSnapshot();
      return reply.code(204).send();
    });
  });

  return server;
}
