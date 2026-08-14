import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ProjectSchema } from '../src/schema.js';

const outputUrl = new URL('../schema/project.schema.json', import.meta.url);
const schema = z.toJSONSchema(ProjectSchema, {
  target: 'draft-2020-12',
  unrepresentable: 'any',
});

const document = {
  $id: 'https://cd3.local/schema/project-v1.schema.json',
  title: 'CD3 Project Snapshot v1',
  ...schema,
};

await mkdir(new URL('../schema/', import.meta.url), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${fileURLToPath(outputUrl)}`);
