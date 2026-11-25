import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";

export const PORTAL_BASE = "/vendor-portal";

// Matches /vendor-portal and everything below it and nothing else. It does not
// match /vendor, /vendor/..., /vendorportal or /admin..., so the API routes and
// the admin dashboard are never shadowed.
export const PORTAL_MATCHER = /^\/vendor-portal(?:\/.*)?$/;

// The portal shares an origin with the admin dashboard, so the policy is strict:
// only same-origin scripts, no framing, no plugins. Inline styles stay allowed
// because the UI kit sets style attributes; inline scripts never are.
export const PORTAL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export type PortalTargetKind = "index" | "asset" | "file";
export type PortalTarget = { file: string; kind: PortalTargetKind };

// The directory holding the built portal. The image sets VENDOR_PORTAL_DIR; in
// development the portal build copies its output to apps/backend/static/vendor-portal.
export const portalRoot = (): string =>
  path.resolve(process.env.VENDOR_PORTAL_DIR ?? path.join(process.cwd(), "static", "vendor-portal"));

// Maps a request URL to a file under root, or null when the answer must be 404.
// The URL is decoded exactly once; anything that still holds a percent sign, a
// backslash, a NUL byte or a dot segment afterwards is refused, and the final
// real path must stay inside the real root.
export const resolvePortalTarget = async (
  rawUrl: string,
  root: string
): Promise<PortalTarget | null> => {
  const pathOnly = rawUrl.split("?")[0].split("#")[0];
  if (pathOnly !== PORTAL_BASE && !pathOnly.startsWith(`${PORTAL_BASE}/`)) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly.slice(PORTAL_BASE.length));
  } catch {
    return null;
  }
  if (decoded.includes("%") || decoded.includes("\\") || decoded.includes("\0")) {
    return null;
  }

  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }

  const index = path.join(root, "index.html");
  if (segments.length === 0) {
    return { file: index, kind: "index" };
  }

  const candidate = path.join(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) {
      return null;
    }
    if ((await stat(realCandidate)).isFile()) {
      return { file: realCandidate, kind: segments[0] === "assets" ? "asset" : "file" };
    }
  } catch {
    // Not found: decided below.
  }

  // A missing path with a file extension is a missing file, not a screen.
  if (path.extname(segments[segments.length - 1]) !== "") {
    return null;
  }
  return { file: index, kind: "index" };
};

export const portalHeaders = (kind: PortalTargetKind): Record<string, string> => ({
  "Content-Security-Policy": PORTAL_CSP,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // Hashed assets never change under the same name; the index must always be
  // fetched fresh so a new build is picked up.
  "Cache-Control":
    kind === "asset"
      ? "public, max-age=31536000, immutable"
      : kind === "file"
        ? "no-cache"
        : "no-store",
});

const sendNotFound = (res: MedusaResponse): void => {
  res.statusCode = 404;
  for (const [name, value] of Object.entries(portalHeaders("index"))) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
};

// Serves the portal. It answers every request it matches itself (the files are
// public static assets, nothing here is per vendor) and never calls next except
// for an unexpected error. req.originalUrl is used because the router strips the
// matched prefix from req.url.
export const servePortal = async (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> => {
  try {
    const target = await resolvePortalTarget(req.originalUrl ?? req.url ?? "", portalRoot());
    if (!target) {
      sendNotFound(res);
      return;
    }

    let body: Buffer;
    try {
      body = await readFile(target.file);
    } catch {
      // The portal has not been built into this directory.
      sendNotFound(res);
      return;
    }

    res.statusCode = 200;
    for (const [name, value] of Object.entries(portalHeaders(target.kind))) {
      res.setHeader(name, value);
    }
    res.setHeader(
      "Content-Type",
      CONTENT_TYPES[path.extname(target.file).toLowerCase()] ?? "application/octet-stream"
    );
    res.setHeader("Content-Length", body.length);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    next(error);
  }
};

export const portalRouteEntries: MiddlewareRoute[] = [
  {
    matcher: PORTAL_MATCHER,
    method: ["GET", "HEAD"],
    middlewares: [servePortal] as unknown as MiddlewareRoute["middlewares"],
  },
];
