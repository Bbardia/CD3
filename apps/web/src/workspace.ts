import { northstarCommerceProject } from '@cd3/fixtures';
import {
  compileView,
  projectViewTo2D,
  projectViewTo3D,
  type CompiledView,
  type ProjectedView2D,
  type ProjectedView3D,
} from '@cd3/layout';

export const project = northstarCommerceProject;

export const workspaceViewIds = ['system-context', 'core-containers', 'order-components'] as const;
export type WorkspaceViewId = (typeof workspaceViewIds)[number];

export interface WorkspaceView {
  readonly compiled: CompiledView;
  readonly twoD: ProjectedView2D;
  readonly threeD: ProjectedView3D;
}

const workspaceViewIdSet = new Set<string>(workspaceViewIds);
const cache = new Map<WorkspaceViewId, WorkspaceView>();

export function isWorkspaceViewId(viewId: string): viewId is WorkspaceViewId {
  return workspaceViewIdSet.has(viewId);
}

export function getWorkspaceView(viewId: string): WorkspaceView {
  if (!isWorkspaceViewId(viewId)) {
    throw new RangeError(`Unsupported workspace view "${viewId}".`);
  }
  const cached = cache.get(viewId);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileView(project, viewId);
  const workspaceView = Object.freeze({
    compiled,
    twoD: projectViewTo2D(compiled),
    threeD: projectViewTo3D(compiled, project.threeD.policy),
  });
  cache.set(viewId, workspaceView);
  return workspaceView;
}
