// Turns the URL of an incoming admin request into the two path forms the
// permission manifest matches against.
//
// The manifest decides who may call a route, so the path it sees has to be the
// path the router will act on. Every form that could make a protected route
// look like an unprotected one is rejected here instead of being "fixed":
// double encoding, encoded slashes, backslashes, control characters and dot
// segments all end in a refusal, and the caller answers with an error.
//
// No Medusa imports: this file is plain TypeScript so it can be unit tested and
// reused by every middleware chain.

export type PathRejection =
  | "bad_encoding"
  | "double_encoding"
  | "dot_segment"
  | "forbidden_character";

export type NormalizedPath =
  | {
      ok: true;
      /** Lower-cased path used for rule matching. */
      matchPath: string;
      /** Same normalisation, original letter case, used to read ids. */
      casePath: string;
    }
  | { ok: false; reason: PathRejection };

// Backslash, control characters and DEL. A decoded %5c or %00 lands here too.
const FORBIDDEN = /[\\\u0000-\u001f\u007f]/;

const rejected = (reason: PathRejection): NormalizedPath => ({ ok: false, reason });

// Lower-cases ASCII letters only, so Unicode case folding can never turn two
// different paths into the same one.
const lowerAscii = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * @param raw the full original URL path of the request, with or without a
 * query string (for an Express request this is `req.originalUrl`).
 */
export function normalizeAdminPath(raw: string): NormalizedPath {
  let path = typeof raw === "string" ? raw : "";

  const fragmentAt = path.indexOf("#");
  if (fragmentAt !== -1) {
    path = path.slice(0, fragmentAt);
  }
  const queryAt = path.indexOf("?");
  if (queryAt !== -1) {
    path = path.slice(0, queryAt);
  }

  if (!path.startsWith("/")) {
    return rejected("forbidden_character");
  }
  // An encoded slash would change where one segment ends and the next begins.
  if (FORBIDDEN.test(path) || /%2f/i.test(path)) {
    return rejected("forbidden_character");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return rejected("bad_encoding");
  }
  // Decode exactly once. Anything that still looks like an escape was encoded
  // twice, which only an attacker has a reason to do.
  if (/%[0-9a-f]{2}/i.test(decoded)) {
    return rejected("double_encoding");
  }
  if (FORBIDDEN.test(decoded)) {
    return rejected("forbidden_character");
  }

  const segments: string[] = [];
  for (const piece of decoded.split("/")) {
    // Path parameters such as `/integrations;x=1` are ignored by the router,
    // so they are ignored here too.
    const segment = piece.split(";")[0];
    if (segment === "") {
      continue;
    }
    if (segment === "." || segment === "..") {
      return rejected("dot_segment");
    }
    segments.push(segment);
  }

  const casePath = `/${segments.join("/")}`;
  return { ok: true, matchPath: lowerAscii(casePath), casePath };
}

/** Upper-cases the method and treats HEAD as GET. OPTIONS stays OPTIONS. */
export function normalizeMethod(method: string): string {
  const upper = String(method ?? "").toUpperCase();
  return upper === "HEAD" ? "GET" : upper;
}
