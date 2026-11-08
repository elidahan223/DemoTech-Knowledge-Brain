import type { AppState } from '../types/app.types';
export const count = (state: AppState | null, status: string) =>
  state?.documents.find((d) => d.status === status)?.count || 0;
export const number = (n: number) => n.toLocaleString('he-IL');
export function eta(seconds: number | null) {
  if (seconds === null) return 'מחשב קצב…';
  if (seconds < 90) return `כ־${seconds} שניות`;
  if (seconds < 5400) return `כ־${Math.round(seconds / 60)} דקות`;
  return `כ־${(seconds / 3600).toFixed(1)} שעות`;
}
