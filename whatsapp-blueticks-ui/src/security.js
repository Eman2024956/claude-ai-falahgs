// Production security helpers without extra dependencies.
import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** HTTP Basic auth for the whole UI/API (except paths in `open`). Enabled when APP_PASSWORD is set. */
export function basicAuth({ user, password, open = [] }) {
  return (req, res, next) => {
    if (!password || open.some((p) => req.path.startsWith(p))) return next();
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && token) {
      const [u, ...rest] = Buffer.from(token, 'base64').toString().split(':');
      if (safeEqual(u, user) && safeEqual(rest.join(':'), password)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="WhatsApp Sender", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

/** Basic security headers. */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
}

/** Tiny fixed-window rate limiter per IP. */
export function rateLimit({ windowMs, max, message = 'Too many requests, slow down.' }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: message });
    next();
  };
}
