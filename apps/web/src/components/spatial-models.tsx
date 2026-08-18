import type { ReactNode } from 'react';
import { RoundedBox } from '@react-three/drei';
import type { ViewNode3D } from '@cd3/layout';

import { modelKeyFor, type SpatialModelKey } from './spatial-icon';

export { modelKeyFor, type SpatialModelKey } from './spatial-icon';

/** Colour roles every prop is painted from, so a model reads as one object, not a silhouette. */
type Tone = 'accent' | 'body' | 'dark' | 'light';

type Vector = readonly [number, number, number];

type ModelPart =
  | {
      readonly shape: 'box';
      readonly size: Vector;
      readonly tone: Tone;
      readonly position: Vector;
      readonly rotation?: Vector;
    }
  | {
      readonly shape: 'mesh';
      readonly geometry: ReactNode;
      readonly tone: Tone;
      readonly position: Vector;
      readonly rotation?: Vector;
    };

/** Each prop carries its own palette: technology reads from the object, C4 kind from the tile. */
const PALETTES: Readonly<Record<SpatialModelKey, Readonly<Record<Tone, string>>>> = {
  analytics: { body: '#1f9db0', accent: '#54c4d4', light: '#c8eef4', dark: '#116575' },
  browser: { body: '#54687d', accent: '#3f8fd8', light: '#f3f7fb', dark: '#2c4a63' },
  cloud: { body: '#cfe0f2', accent: '#a3c4ea', light: '#eef5fc', dark: '#7d9dc0' },
  component: { body: '#4c3a8f', accent: '#6a4fd0', light: '#c9bcf2', dark: '#2f2263' },
  database: { body: '#4f7fd4', accent: '#7ba5ea', light: '#c9dcf8', dark: '#2e4d8c' },
  gateway: { body: '#6f5bd0', accent: '#9c8ce7', light: '#ded7f8', dark: '#403289' },
  lock: { body: '#b5484a', accent: '#d9776f', light: '#f4d5d0', dark: '#7d2a2e' },
  mobile: { body: '#3d4c59', accent: '#5fa8e8', light: '#eef4f9', dark: '#26313b' },
  person: { body: '#b4531a', accent: '#e08a3c', light: '#f7dab6', dark: '#7d3708' },
  queue: { body: '#d9a13a', accent: '#efc271', light: '#f7e3b8', dark: '#8c6215' },
  server: { body: '#54748f', accent: '#3fae86', light: '#e4edf4', dark: '#325069' },
  storage: { body: '#9a6b42', accent: '#c08e5d', light: '#ecd9c2', dark: '#6b452a' },
  system: { body: '#5c7794', accent: '#8ba5bf', light: '#dce6ef', dark: '#385470' },
  worker: { body: '#2fa08a', accent: '#66c8b3', light: '#c6ede4', dark: '#196857' },
};

const QUARTER = Math.PI / 2;

function box(tone: Tone, size: Vector, position: Vector, rotation?: Vector): ModelPart {
  return { shape: 'box', tone, size, position, ...(rotation === undefined ? {} : { rotation }) };
}

function mesh(tone: Tone, geometry: ReactNode, position: Vector, rotation?: Vector): ModelPart {
  return {
    shape: 'mesh',
    tone,
    geometry,
    position,
    ...(rotation === undefined ? {} : { rotation }),
  };
}

function cogTooth(index: number): ModelPart {
  const angle = index * QUARTER + Math.PI / 4;
  return box(
    'accent',
    [0.14, 0.12, 0.13],
    [Math.cos(angle) * 0.25, 0.26 + Math.sin(angle) * 0.25, 0],
    [0, 0, angle],
  );
}

// ponytail: procedural low-poly primitives, no glTF pipeline until real icon art exists.
const MODELS: Readonly<Record<SpatialModelKey, readonly ModelPart[]>> = {
  // Three rising columns on a plinth.
  analytics: [
    box('light', [0.62, 0.06, 0.4], [0, 0.04, 0]),
    box('accent', [0.13, 0.2, 0.13], [-0.18, 0.17, 0]),
    box('body', [0.13, 0.34, 0.13], [0, 0.24, 0]),
    box('dark', [0.13, 0.48, 0.13], [0.18, 0.31, 0]),
  ],
  // A browser window on a stand: light pane, coloured title bar, dark neck.
  browser: [
    box('light', [0.78, 0.5, 0.07], [0, 0.44, 0.01], [-0.12, 0, 0]),
    box('accent', [0.78, 0.11, 0.08], [0, 0.65, 0.04], [-0.12, 0, 0]),
    box('dark', [0.09, 0.15, 0.09], [0, 0.11, 0]),
    box('body', [0.42, 0.05, 0.24], [0, 0.03, 0]),
  ],
  cloud: [
    mesh('body', <sphereGeometry args={[0.19, 12, 9]} />, [-0.21, 0.22, 0.01]),
    mesh('light', <sphereGeometry args={[0.24, 14, 10]} />, [0.01, 0.29, 0.01]),
    mesh('body', <sphereGeometry args={[0.17, 12, 9]} />, [0.24, 0.2, -0.02]),
    box('accent', [0.66, 0.07, 0.24], [0, 0.13, 0]),
  ],
  // A pedestal under a floating octahedron: the smallest unit of the model.
  component: [
    mesh('accent', <octahedronGeometry args={[0.24]} />, [0, 0.36, 0]),
    box('body', [0.3, 0.09, 0.3], [0, 0.05, 0], [0, QUARTER / 2, 0]),
  ],
  database: [
    mesh('body', <cylinderGeometry args={[0.26, 0.26, 0.15, 20]} />, [0, 0.09, 0]),
    mesh('dark', <cylinderGeometry args={[0.265, 0.265, 0.025, 20]} />, [0, 0.18, 0]),
    mesh('body', <cylinderGeometry args={[0.26, 0.26, 0.15, 20]} />, [0, 0.27, 0]),
    mesh('dark', <cylinderGeometry args={[0.265, 0.265, 0.025, 20]} />, [0, 0.36, 0]),
    mesh('accent', <cylinderGeometry args={[0.26, 0.26, 0.15, 20]} />, [0, 0.45, 0]),
    mesh('light', <cylinderGeometry args={[0.2, 0.2, 0.02, 20]} />, [0, 0.53, 0]),
  ],
  // A padlock: body below, shackle arcing over it.
  lock: [
    box('body', [0.38, 0.3, 0.2], [0, 0.17, 0]),
    box('light', [0.07, 0.12, 0.03], [0, 0.17, 0.11]),
    mesh('dark', <torusGeometry args={[0.13, 0.035, 8, 16, Math.PI]} />, [0, 0.32, 0]),
  ],
  // A phone: dark slab, light screen, home dot.
  mobile: [
    box('dark', [0.28, 0.52, 0.07], [0, 0.28, 0]),
    box('light', [0.23, 0.4, 0.02], [0, 0.31, 0.035]),
    mesh('accent', <sphereGeometry args={[0.02, 8, 6]} />, [0, 0.09, 0.045]),
  ],
  // A rack-mount router: body, lit port strip, two aerials.
  gateway: [
    box('body', [0.72, 0.22, 0.46], [0, 0.14, 0]),
    box('accent', [0.5, 0.06, 0.03], [0, 0.14, 0.24]),
    mesh('dark', <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />, [-0.18, 0.4, -0.02]),
    mesh('dark', <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />, [0.18, 0.4, -0.02]),
    mesh('light', <sphereGeometry args={[0.035, 8, 6]} />, [-0.18, 0.56, -0.02]),
    mesh('light', <sphereGeometry args={[0.035, 8, 6]} />, [0.18, 0.56, -0.02]),
  ],
  person: [
    mesh('body', <capsuleGeometry args={[0.13, 0.16, 4, 12]} />, [0, 0.21, 0]),
    box('accent', [0.34, 0.08, 0.2], [0, 0.32, 0]),
    mesh('light', <sphereGeometry args={[0.13, 14, 10]} />, [0, 0.5, 0]),
  ],
  // A pipe with collars and a payload cube riding it.
  queue: [
    mesh('body', <cylinderGeometry args={[0.17, 0.17, 0.72, 16]} />, [0, 0.28, 0], [0, 0, QUARTER]),
    mesh('dark', <torusGeometry args={[0.18, 0.035, 8, 16]} />, [-0.29, 0.28, 0], [0, QUARTER, 0]),
    mesh('dark', <torusGeometry args={[0.18, 0.035, 8, 16]} />, [0.29, 0.28, 0], [0, QUARTER, 0]),
    box('accent', [0.16, 0.16, 0.16], [0.05, 0.55, 0], [0, QUARTER / 2, 0]),
  ],
  server: [
    box('body', [0.5, 0.56, 0.44], [0, 0.29, 0]),
    box('light', [0.38, 0.06, 0.03], [0, 0.44, 0.23]),
    box('light', [0.38, 0.06, 0.03], [0, 0.29, 0.23]),
    box('light', [0.38, 0.06, 0.03], [0, 0.14, 0.23]),
    mesh('accent', <sphereGeometry args={[0.035, 8, 6]} />, [0.19, 0.51, 0.23]),
  ],
  // A crate with a proud lid.
  storage: [
    box('body', [0.5, 0.3, 0.4], [0, 0.16, 0]),
    box('light', [0.56, 0.09, 0.46], [0, 0.36, 0]),
    box('dark', [0.5, 0.05, 0.41], [0, 0.16, 0]),
  ],
  // Two boxes stacked off-centre: a system is a container of containers.
  system: [
    box('body', [0.62, 0.22, 0.46], [0, 0.13, 0]),
    box('accent', [0.44, 0.22, 0.34], [0.04, 0.36, -0.02]),
    box('light', [0.16, 0.05, 0.03], [-0.18, 0.13, 0.24]),
  ],
  worker: [
    mesh('body', <cylinderGeometry args={[0.24, 0.24, 0.13, 16]} />, [0, 0.26, 0], [QUARTER, 0, 0]),
    cogTooth(0),
    cogTooth(1),
    cogTooth(2),
    cogTooth(3),
    mesh(
      'light',
      <cylinderGeometry args={[0.08, 0.08, 0.16, 12]} />,
      [0, 0.26, 0],
      [QUARTER, 0, 0],
    ),
  ],
};

/** Scales the prop to the block it stands on, so it reads without swallowing the tile. */
function modelFit(node: ViewNode3D): number {
  return Math.min(2.2, Math.max(0.8, Math.min(node.size[0], node.size[2]) * 0.9));
}

/** Renders the prop for a node, scaled to the block it stands on. */
export function SpatialModel({
  node,
  position,
}: {
  readonly node: ViewNode3D;
  readonly position: Vector;
}) {
  const key = modelKeyFor(node);
  const palette = PALETTES[key];

  return (
    <group position={[position[0], position[1], position[2]]} scale={modelFit(node)}>
      {MODELS[key].map((part, index) => {
        const material = (
          <meshStandardMaterial
            color={palette[part.tone]}
            roughness={0.62}
            metalness={0}
            flatShading
          />
        );
        const position2: [number, number, number] = [
          part.position[0],
          part.position[1],
          part.position[2],
        ];
        const rotation: [number, number, number] = [...(part.rotation ?? [0, 0, 0])];
        return part.shape === 'box' ? (
          <RoundedBox
            key={index}
            args={[part.size[0], part.size[1], part.size[2]]}
            radius={Math.min(0.035, Math.min(...part.size) * 0.32)}
            smoothness={2}
            position={position2}
            rotation={rotation}
          >
            {material}
          </RoundedBox>
        ) : (
          <mesh key={index} position={position2} rotation={rotation}>
            {part.geometry}
            {material}
          </mesh>
        );
      })}
    </group>
  );
}
