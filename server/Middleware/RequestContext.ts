import type express from 'express';
import type { Access } from '../store.js';
export const requestAccess = (_req: express.Request): Access => undefined;
export const serverTiming = (timings: Record<string, number>) =>
  Object.entries(timings)
    .filter(([k]) => k.endsWith('Ms'))
    .map(([k, v]) => `${k.replace(/Ms$/, '')};dur=${v.toFixed(1)}`)
    .join(', ');
