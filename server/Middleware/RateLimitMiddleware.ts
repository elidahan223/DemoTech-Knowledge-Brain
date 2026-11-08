import type { RequestHandler } from 'express';
export function rateLimitMiddleware(): RequestHandler {
  const rateBuckets = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const key = req.ip || 'local',
      now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > 60000) {
      bucket = { start: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    if (++bucket.count > 600) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'יותר מדי בקשות; נסו שוב בעוד דקה' });
    }
    next();
  };
}
