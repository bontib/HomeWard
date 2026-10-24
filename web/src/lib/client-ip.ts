// The login rate limit is keyed by client address. Next.js app routes cannot see the socket,
// and X-Forwarded-For is whatever the client sent unless a trusted proxy overwrote it.
// So without TRUSTED_PROXY we drop these headers: every client then shares one bucket per
// endpoint, which is strict but cannot be bypassed by spoofing.
const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
];

export function withoutForwardingHeaders(req: Request): Request {
  const headers = new Headers(req.headers);
  for (const name of FORWARDING_HEADERS) headers.delete(name);
  return new Request(req, { headers });
}

export function forRateLimit(req: Request, trustProxy: boolean): Request {
  return trustProxy ? req : withoutForwardingHeaders(req);
}
