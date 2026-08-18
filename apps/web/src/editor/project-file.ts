import { ProjectSchema, type ReadonlyProject } from '@cd3/domain';

/** Lowercase, URL-safe file stem derived from the project name. */
export function fileStem(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? 'project' : slug;
}

function download(filename: string, href: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
}

export function downloadProjectFile(project: ReadonlyProject): void {
  const blob = new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(`${fileStem(project.name)}.c4.json`, url);
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  download(filename, dataUrl);
}

/** A file is a project only if the domain says so; anything else is undefined, never repaired. */
export function parseProjectFile(text: string): ReadonlyProject | undefined {
  try {
    const result = ProjectSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
