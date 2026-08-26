#!/usr/bin/env node
/**
 * Imports a Docker Compose project into CD3 as a new container view.
 *
 *   docker compose config --format json | node scripts/import-compose.mjs my-stack
 *   docker compose config --format json | node scripts/import-compose.mjs my-stack --dry
 *
 * Reads the resolved compose config from stdin (JSON — no YAML dependency needed), then creates
 * one software system, one container per service, relationships from depends_on, and a view that
 * shows them, all through the validated command API on 127.0.0.1:6985.
 */

const API = process.env.CD3_API ?? 'http://127.0.0.1:6985';
// Keep this in sync with the API's intentionally small atomic command-batch ceiling. Splitting an
// import would leave a half-created architecture behind if a later batch failed.
const MAX_ATOMIC_COMMANDS = 100;

function slug(name) {
  const cleaned = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned === '' ? 'imported' : cleaned;
}

/** Tag services by image so CD3's icon inference gives them recognizable props. */
function tagsFor(image) {
  const name = String(image ?? '').toLowerCase();
  if (/postgres|mysql|mariadb|mongo/.test(name)) return ['service', 'database'];
  if (/redis|memcached/.test(name)) return ['service', 'cache'];
  if (/kafka|nats|rabbitmq/.test(name)) return ['service', 'messaging'];
  if (/nginx|traefik|caddy|haproxy/.test(name)) return ['service', 'api', 'edge'];
  if (/minio/.test(name)) return ['service', 'storage'];
  if (/grafana|prometheus/.test(name)) return ['service', 'analytics'];
  return ['service'];
}

async function main() {
  const stackName = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (stackName === undefined || stackName.startsWith('--')) {
    console.error(
      'Usage: docker compose config --format json | node scripts/import-compose.mjs <stack-name> [--dry]',
    );
    process.exit(2);
  }

  const stdin = await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
  const config = JSON.parse(stdin);
  const services = Object.entries(config.services ?? {});
  if (services.length === 0) {
    console.error('No services found in the compose config.');
    process.exit(1);
  }

  const systemId = slug(stackName);
  const viewId = `${systemId}-containers`;
  const commands = [];
  const serviceIds = new Map();

  for (const [serviceName] of services) {
    const id = `${systemId}-${slug(serviceName)}`;
    const previous = serviceIds.get(id);
    if (previous !== undefined) {
      console.error(
        `Services "${previous}" and "${serviceName}" both normalize to CD3 id "${id}". Rename one service before importing.`,
      );
      process.exit(1);
    }
    serviceIds.set(id, serviceName);
  }

  commands.push({
    type: 'create-element',
    element: {
      id: systemId,
      kind: 'softwareSystem',
      name: stackName,
      technology: 'Docker Compose',
      tags: ['software-system', 'imported'],
      properties: {},
      externalRefs: [],
    },
  });
  commands.push({
    type: 'create-view',
    view: {
      id: viewId,
      type: 'container',
      scopeElementId: systemId,
      name: `${stackName} — Containers`,
      items: {},
      placements: {},
      relationshipIds: [],
    },
  });

  const columns = Math.max(1, Math.ceil(Math.sqrt(services.length)));
  services.forEach(([serviceName, service], index) => {
    const id = `${systemId}-${slug(serviceName)}`;
    const column = index % columns;
    const row = Math.floor(index / columns);
    commands.push({
      type: 'create-element',
      element: {
        id,
        kind: 'container',
        parentId: systemId,
        name: serviceName,
        technology: String(service.image ?? 'container'),
        tags: tagsFor(service.image),
        properties: {},
        externalRefs: [],
      },
      placeInView: {
        viewId,
        itemId: `${viewId}-item-${slug(serviceName)}`,
        placement: { x: column * 340, y: row * 220, width: 240, height: 110 },
      },
    });
  });

  for (const [serviceName, service] of services) {
    const dependsOn = Array.isArray(service.depends_on)
      ? service.depends_on
      : Object.keys(service.depends_on ?? {});
    for (const dependency of dependsOn) {
      commands.push({
        type: 'create-relationship',
        relationship: {
          id: `${systemId}-${slug(serviceName)}-${slug(dependency)}`,
          name: 'Depends on',
          sourceId: `${systemId}-${slug(serviceName)}`,
          targetId: `${systemId}-${slug(dependency)}`,
          interaction: 'synchronous',
          tags: ['imported'],
          properties: {},
          externalRefs: [],
        },
        showInViewId: viewId,
      });
    }
  }

  if (dry) {
    console.log(JSON.stringify({ commands }, null, 2));
    return;
  }

  if (commands.length > MAX_ATOMIC_COMMANDS) {
    console.error(
      `This stack needs ${String(commands.length)} commands, but CD3 accepts at most ${String(MAX_ATOMIC_COMMANDS)} in one atomic import. Reduce the stack or import it as smaller independent projects.`,
    );
    process.exit(1);
  }

  const revisionResponse = await fetch(`${API}/api/project/revision`);
  if (!revisionResponse.ok) {
    console.error('No CD3 project is saved yet — open the app once, or PUT a project first.');
    process.exit(1);
  }
  const { revision } = await revisionResponse.json();
  const response = await fetch(`${API}/api/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: revision, commands }),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(`Import failed (${String(response.status)}):`, body);
    process.exit(1);
  }
  console.log(
    `Imported ${String(services.length)} services into view "${viewId}" (revision ${String(body.revision)}).`,
  );
}

await main();
