import type { MapQuery } from '../types/app.types';
export function mapUrl(query: MapQuery, search: string, filter: string, offset = 0) {
  const p = new URLSearchParams();
  if (query.kind === 'overview') p.set('overview', '1');
  if (search.trim() || filter !== 'all') {
    p.set('search', search.trim());
    p.set('type', filter);
    p.set('limit', '200');
  } else if (query.kind === 'group') {
    p.set('group', query.group);
    p.set('limit', '80');
    p.set('offset', String(offset));
  } else if (query.kind === 'center') {
    p.set('center', query.id);
    p.set('limit', '150');
  } else if (query.kind === 'focus') {
    p.set('ids', query.ids.join(','));
    p.set('limit', '150');
  }
  return '/map?' + p;
}
