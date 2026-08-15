import type { ReadonlyProject } from '@cd3/domain';
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
}

const workspaceViewIdSet = new Set<string>(workspaceViewIds);
const workspaceViewCache = new WeakMap<ReadonlyProject, Map<WorkspaceViewId, WorkspaceView>>();
const projection3DCache = new WeakMap<ReadonlyProject, Map<WorkspaceViewId, ProjectedView3D>>();

export function isWorkspaceViewId(viewId: string): viewId is WorkspaceViewId {
  return workspaceViewIdSet.has(viewId);
}

function requireWorkspaceViewId(viewId: string): WorkspaceViewId {
  if (!isWorkspaceViewId(viewId)) {
    throw new RangeError(`Unsupported workspace view "${viewId}".`);
  }
  return viewId;
}

export function getWorkspaceView(activeProject: ReadonlyProject, viewId: string): WorkspaceView {
  const workspaceViewId = requireWorkspaceViewId(viewId);
  let projectCache = workspaceViewCache.get(activeProject);
  if (projectCache === undefined) {
    projectCache = new Map();
    workspaceViewCache.set(activeProject, projectCache);
  }

  const cached = projectCache.get(workspaceViewId);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileView(activeProject, workspaceViewId);
  const workspaceView = Object.freeze({
    compiled,
    twoD: projectViewTo2D(compiled),
  });
  projectCache.set(workspaceViewId, workspaceView);
  return workspaceView;
}

export function getWorkspaceProjection3D(
  activeProject: ReadonlyProject,
  viewId: string,
): ProjectedView3D {
  const workspaceViewId = requireWorkspaceViewId(viewId);
  let projectCache = projection3DCache.get(activeProject);
  if (projectCache === undefined) {
    projectCache = new Map();
    projection3DCache.set(activeProject, projectCache);
  }

  const cached = projectCache.get(workspaceViewId);
  if (cached !== undefined) {
    return cached;
  }

  const { compiled } = getWorkspaceView(activeProject, workspaceViewId);
  const projection = projectViewTo3D(compiled, activeProject.threeD.policy);
  projectCache.set(workspaceViewId, projection);
  return projection;
}
