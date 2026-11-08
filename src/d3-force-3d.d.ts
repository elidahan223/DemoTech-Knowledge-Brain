declare module 'd3-force-3d' {
  export type SimNode = {
    id: string;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
    index?: number;
  };
  export type SimLink = { source: string | SimNode; target: string | SimNode; index?: number };
  type Force = {
    (alpha: number): void;
    strength(value: number | ((...args: any[]) => number)): Force;
    distance?(value: number | ((...args: any[]) => number)): Force;
  };
  export interface Simulation {
    force(name: string, force: unknown): Simulation;
    tick(iterations?: number): Simulation;
    stop(): Simulation;
    velocityDecay(value: number): Simulation;
    alpha(value: number): Simulation;
    alphaDecay(value: number): Simulation;
    nodes(): SimNode[];
  }
  export function forceSimulation(nodes: SimNode[], dimensions?: number): Simulation;
  export function forceManyBody(): Force & { theta(value: number): Force };
  export function forceLink(links: SimLink[]): Force & {
    id(
      fn: (node: SimNode) => string,
    ): Force & { distance(value: number | ((link: any) => number)): Force };
  };
  export function forceCenter(x?: number, y?: number, z?: number): Force;
  export function forceX(x?: number): Force;
  export function forceY(y?: number): Force;
  export function forceZ(z?: number): Force;
}
