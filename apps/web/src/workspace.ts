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
const deeplyFrozenProjects = new WeakSet<ReadonlyProject>();
const workspaceViewCache = new WeakMap<ReadonlyProject, Map<WorkspaceViewId, WorkspaceView>>();
const projection3DCache = new WeakMap<ReadonlyProject, Map<WorkspaceViewId, ProjectedView3D>>();

function isDeeplyFrozenProject(activeProject: ReadonlyProject): boolean {
  if (deeplyFrozenProjects.has(activeProject)) {
    return true;
  }

  const visited = new Set<object>();
  const isDeeplyFrozenValue = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') {
      return typeof value !== 'function';
    }
    if (visited.has(value)) {
      return true;
    }

    const prototype = Reflect.getPrototypeOf(value);
    const isJsonLikeObject = Array.isArray(value)
      ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null;
    if (!isJsonLikeObject || !Object.isFrozen(value)) {
      return false;
    }

    visited.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        !isDeeplyFrozenValue(descriptor.value)
      ) {
        return false;
      }
    }
    return true;
  };

  try {
    if (!isDeeplyFrozenValue(activeProject)) {
      return false;
    }
  } catch {
    return false;
  }

  deeplyFrozenProjects.add(activeProject);
  return true;
}

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
  const cacheable = isDeeplyFrozenProject(activeProject);
  let projectCache = cacheable ? workspaceViewCache.get(activeProject) : undefined;

  const cached = projectCache?.get(workspaceViewId);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileView(activeProject, workspaceViewId);
  const workspaceView = Object.freeze({
    compiled,
    twoD: projectViewTo2D(compiled),
  });
  if (cacheable) {
    projectCache ??= new Map();
    projectCache.set(workspaceViewId, workspaceView);
    workspaceViewCache.set(activeProject, projectCache);
  }
  return workspaceView;
}

export function getWorkspaceProjection3D(
  activeProject: ReadonlyProject,
  viewId: string,
): ProjectedView3D {
  const workspaceViewId = requireWorkspaceViewId(viewId);
  const cacheable = isDeeplyFrozenProject(activeProject);
  let projectCache = cacheable ? projection3DCache.get(activeProject) : undefined;

  const cached = projectCache?.get(workspaceViewId);
  if (cached !== undefined) {
    return cached;
  }

  const { compiled } = getWorkspaceView(activeProject, workspaceViewId);
  const projection = projectViewTo3D(compiled, activeProject.threeD.policy);
  if (cacheable) {
    projectCache ??= new Map();
    projectCache.set(workspaceViewId, projection);
    projection3DCache.set(activeProject, projectCache);
  }
  return projection;
}
