import { mkdir, writeFile } from 'node:fs/promises';
import { ProjectSchema } from '@cd3/domain';
import { northstarCommerceProject } from '../src/northstar-commerce.js';

const projectsDirectoryUrl = new URL('../projects/', import.meta.url);
const outputUrl = new URL('northstar-commerce.c4.json', projectsDirectoryUrl);
const validatedProject = ProjectSchema.parse(northstarCommerceProject);
const serializedProject = `${JSON.stringify(validatedProject, null, 2)}\n`;

await mkdir(projectsDirectoryUrl, { recursive: true });
await writeFile(outputUrl, serializedProject, 'utf8');
