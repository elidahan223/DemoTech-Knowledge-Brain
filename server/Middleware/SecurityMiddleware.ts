import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { ServerSettings } from '../Settings/ServerSettings.js';
export function securityMiddleware(settings: ServerSettings): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host?.split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host || ''))
      return res.status(403).json({ error: 'Invalid host' });
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        `http://127.0.0.1:${settings.boundPort}`,
        `http://localhost:${settings.boundPort}`,
      ].includes(origin)
    )
      return res.status(403).json({ error: 'Invalid origin' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return res.status(403).json({ error: 'Cross-site access denied' });
    if (settings.desktop) {
      const cookie = req.headers.cookie
        ?.split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('brain-session='))
        ?.slice('brain-session='.length);
      const received = req.get('X-Brain-Token') || cookie || '';
      const expected = Buffer.from(settings.desktopToken!);
      const supplied = Buffer.from(received);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return res.status(403).json({ error: 'Desktop session required' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.NODE_ENV === 'production')
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    next();
  };
}
