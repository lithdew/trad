interface RateLimitBucket {
  windowStartMs: number;
  count: number;
}

const buckets = new Map<string, RateLimitBucket>();
let lastPruneMs = 0;

function getClientIp(req: Request) {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp !== null && cfIp !== "") return cfIp;

  const realIp = req.headers.get("x-real-ip");
  if (realIp !== null && realIp !== "") return realIp;

  const xff = req.headers.get("x-forwarded-for");
  if (xff !== null && xff !== "") {
    const first = xff.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }

  return "ip";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (auth !== null && auth !== "") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1] !== undefined && m[1] !== "") return m[1];
  }

  const headerToken =
    req.headers.get("x-admin-token") ??
    req.headers.get("X-Admin-Token") ??
    req.headers.get("x-trad-admin-token") ??
    req.headers.get("X-Trad-Admin-Token");
  if (headerToken !== null && headerToken !== "") return headerToken;

  // Fallback: query parameter (for libraries like useUIStream that don't support custom headers)
  const url = new URL(req.url);
  const qsToken = url.searchParams.get("_t");
  if (qsToken !== null && qsToken !== "") return qsToken;

  return null;
}

export function isAdminRequest(req: Request) {
  const required = process.env.TRAD_ADMIN_TOKEN ?? null;
  if (required === null || required === "") return false;
  const provided = getBearerToken(req);
  if (provided === null) return false;
  return provided === required;
}

export function requireAdmin(req: Request) {
  const required = process.env.TRAD_ADMIN_TOKEN ?? null;
  const isProd = process.env.NODE_ENV === "production";

  // Secure default for internet deploys: if token isn't set in prod, block.
  if ((required === null || required === "") && isProd) {
    return Response.json({ error: "Server not configured: set TRAD_ADMIN_TOKEN" }, { status: 503 });
  }

  // In dev, allow local development without token.
  if (required === null || required === "") return null;

  if (isAdminRequest(req)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function rateLimit(req: Request, opts: { key: string; limit: number; windowMs: number }) {
  const ip = getClientIp(req);
  const bucketKey = `${opts.key}:${ip}`;

  const now = Date.now();

  // Prevent unbounded growth in long-lived servers.
  if (now - lastPruneMs > 60_000) {
    lastPruneMs = now;
    const cutoff = now - opts.windowMs * 10;
    for (const [k, b] of buckets) {
      if (b.windowStartMs < cutoff) buckets.delete(k);
    }
  }

  const windowStartMs = Math.floor(now / opts.windowMs) * opts.windowMs;

  const existing = buckets.get(bucketKey);
  if (existing === undefined || existing.windowStartMs !== windowStartMs) {
    buckets.set(bucketKey, { windowStartMs, count: 1 });
    return { allowed: true, remaining: Math.max(0, opts.limit - 1), retryAfterMs: 0 };
  }

  if (existing.count >= opts.limit) {
    const retryAfterMs = existing.windowStartMs + opts.windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  existing.count++;
  return { allowed: true, remaining: Math.max(0, opts.limit - existing.count), retryAfterMs: 0 };
}
