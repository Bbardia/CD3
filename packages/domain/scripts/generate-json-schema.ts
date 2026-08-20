import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ProjectSchema } from '../src/schema.js';

const outputUrl = new URL('../schema/project.schema.json', import.meta.url);
const schema = z.toJSONSchema(ProjectSchema, {
  target: 'draft-2020-12',
  unrepresentable: 'any',
});

// Zod's JSON Schema converter cannot encode superRefine rules. Mirror the one structural rule
// external validators can express directly, so the committed contract agrees with ProjectSchema.
if (
  typeof schema === 'object' &&
  schema !== null &&
  'properties' in schema &&
  typeof schema.properties === 'object' &&
  schema.properties !== null &&
  'views' in schema.properties &&
  typeof schema.properties.views === 'object' &&
  schema.properties.views !== null
) {
  Object.assign(schema.properties.views, { minProperties: 1 });
}

const document = {
  $id: 'https://cd3.local/schema/project-v1.schema.json',
  title: 'CD3 Project Snapshot v1',
  ...schema,
};

await mkdir(new URL('../schema/', import.meta.url), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${fileURLToPath(outputUrl)}`);
