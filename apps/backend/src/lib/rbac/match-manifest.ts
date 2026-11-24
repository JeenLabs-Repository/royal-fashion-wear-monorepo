// Matches a request against the permission manifest.
//
// Matching works on path segments and never builds a regular expression from a
// pattern, so a character inside a pattern cannot change what it means. There
// is no catch-all behaviour here: when no rule matches, resolveRule returns
// null and the caller treats the route as superadmin only.
//
// Pattern syntax
// - A segment is a literal (`products`) or a named parameter (`:id`) that
//   matches exactly one non-empty segment.
// - A last segment ending in `*` covers that complete segment and everything
//   below it, so `/admin/products*` covers `/admin/products` and
//   `/admin/products/x/y` but not `/admin/productsx`.
// - Patterns are written in lower case.

import type { ManifestPermission } from "./access";
import { normalizeMethod } from "./normalize-path";

export type ManifestMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH" | "*";

export type ManifestRule = {
  method: ManifestMethod;
  pattern: string;
  permission: ManifestPermission;
  /** Names from the closed guard list in permission-manifest.ts. */
  guards?: readonly string[];
  note?: string;
};

type Segment =
  | { kind: "literal"; value: string }
  | { kind: "param"; name: string };

type CompiledPattern = {
  segments: Segment[];
  wildcard: boolean;
  literalCount: number;
};

const compiledCache = new Map<string, CompiledPattern>();

const lowerAscii = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

export function compilePattern(pattern: string): CompiledPattern {
  const cached = compiledCache.get(pattern);
  if (cached) {
    return cached;
  }

  // These are authoring errors in the manifest, found by its own unit tests,
  // and never reachable from a request.
  const fail = (message: string): never => {
    throw new Error(`Invalid manifest pattern "${pattern}": ${message}`);
  };

  if (!pattern.startsWith("/")) {
    return fail("must start with a slash");
  }

  const pieces = pattern.split("/").slice(1);
  let wildcard = false;
  const lastIndex = pieces.length - 1;
  if (pieces[lastIndex].endsWith("*")) {
    wildcard = true;
    pieces[lastIndex] = pieces[lastIndex].slice(0, -1);
    if (pieces[lastIndex] === "") {
      pieces.pop();
    }
  }
  if (pieces.length === 0) {
    return fail("a catch-all pattern is not allowed");
  }

  const segments: Segment[] = pieces.map((piece) => {
    if (piece === "" || piece.includes("*")) {
      return fail("empty segment or misplaced star");
    }
    if (piece.startsWith(":")) {
      const name = piece.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return fail("bad parameter name");
      }
      return { kind: "param", name } as Segment;
    }
    return { kind: "literal", value: piece } as Segment;
  });

  const compiled: CompiledPattern = {
    segments,
    wildcard,
    literalCount: segments.filter((segment) => segment.kind === "literal").length,
  };
  compiledCache.set(pattern, compiled);
  return compiled;
}

const splitPath = (path: string): string[] =>
  path.split("/").filter((segment) => segment !== "");

function matchesSegments(compiled: CompiledPattern, pathSegments: string[]): boolean {
  if (compiled.wildcard) {
    if (pathSegments.length < compiled.segments.length) {
      return false;
    }
  } else if (pathSegments.length !== compiled.segments.length) {
    return false;
  }
  return compiled.segments.every((segment, index) =>
    segment.kind === "param"
      ? pathSegments[index] !== ""
      : segment.value === lowerAscii(pathSegments[index])
  );
}

/**
 * Finds the most specific rule for a request. Order of preference: more literal
 * segments, an exact pattern over a wildcard of equal literal count, an
 * explicit method over `*`, and finally the earlier rule in the list.
 *
 * @param matchPath the lower-cased path from normalizeAdminPath
 * @returns the rule, or null when none matches (the caller then requires
 * superadmin)
 */
export function resolveRule(
  rules: readonly ManifestRule[],
  method: string,
  matchPath: string
): { rule: ManifestRule } | null {
  const wanted = normalizeMethod(method);
  // OPTIONS is answered before credentials matter; it never selects a rule.
  if (wanted === "OPTIONS") {
    return null;
  }
  const pathSegments = splitPath(matchPath);

  let best: { rule: ManifestRule; key: number[] } | null = null;

  for (const rule of rules) {
    if (rule.method !== "*" && rule.method !== wanted) {
      continue;
    }
    const compiled = compilePattern(rule.pattern);
    if (!matchesSegments(compiled, pathSegments)) {
      continue;
    }
    const key = [
      compiled.literalCount,
      compiled.wildcard ? 0 : 1,
      rule.method === "*" ? 0 : 1,
    ];
    // Strictly greater only, so a tie keeps the earlier rule.
    if (best === null || compareKeys(key, best.key) > 0) {
      best = { rule, key };
    }
  }

  return best ? { rule: best.rule } : null;
}

function compareKeys(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

/**
 * Reads the named parameters of a matched pattern from the case-preserving
 * path, so ids keep their letter case.
 */
export function extractParams(pattern: string, casePath: string): Record<string, string> {
  const compiled = compilePattern(pattern);
  const pathSegments = splitPath(casePath);
  if (!matchesSegments(compiled, pathSegments)) {
    return {};
  }
  const params: Record<string, string> = {};
  compiled.segments.forEach((segment, index) => {
    if (segment.kind === "param") {
      params[segment.name] = pathSegments[index];
    }
  });
  return params;
}

/**
 * True when the rule would match every concrete path of an enumerated route.
 * A rule parameter covers a route literal or parameter, a route parameter is
 * not covered by a rule literal, and a trailing star covers the rest.
 *
 * @param routePattern a route such as `/admin/products/:id`
 */
export function ruleCoversRoute(
  rule: ManifestRule,
  method: string,
  routePattern: string
): boolean {
  const wanted = String(method).toUpperCase();
  if (rule.method !== "*" && rule.method !== wanted) {
    return false;
  }
  const compiled = compilePattern(rule.pattern);
  const route = splitPath(routePattern);
  if (compiled.wildcard) {
    if (route.length < compiled.segments.length) {
      return false;
    }
  } else if (route.length !== compiled.segments.length) {
    return false;
  }
  return compiled.segments.every((segment, index) => {
    if (segment.kind === "param") {
      return true;
    }
    return !route[index].startsWith(":") && lowerAscii(route[index]) === segment.value;
  });
}
