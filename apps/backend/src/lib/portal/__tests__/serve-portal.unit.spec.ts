import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VENDOR_CHAIN_MATCHER } from "../../vendor/middlewares";
import {
  PORTAL_CSP,
  PORTAL_MATCHER,
  portalHeaders,
  portalRouteEntries,
  resolvePortalTarget,
  servePortal,
} from "../serve-portal";

let base: string;
let root: string;
const previousDir = process.env.VENDOR_PORTAL_DIR;

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "portal-"));
  root = path.join(base, "portal");
  mkdirSync(path.join(root, "assets"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(root, "assets", "app.abc123.js"), "console.log(1)");
  // Outside the portal root. A traversal that works would read this file.
  writeFileSync(path.join(base, "secret.txt"), "outside the root");
  process.env.VENDOR_PORTAL_DIR = root;
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  if (previousDir === undefined) {
    delete process.env.VENDOR_PORTAL_DIR;
  } else {
    process.env.VENDOR_PORTAL_DIR = previousDir;
  }
});

type FakeResponse = {
  statusCode: number;
  body: unknown;
  setHeader: (name: string, value: string | number) => void;
  end: (body?: unknown) => void;
};

const run = async (url: string, method = "GET") => {
  const headers: Record<string, string | number> = {};
  const res: FakeResponse = {
    statusCode: 0,
    body: undefined,
    setHeader: (name, value) => {
      headers[name.toLowerCase()] = value;
    },
    end: (body) => {
      res.body = body;
    },
  };
  const next = jest.fn();
  await servePortal({ originalUrl: url, url, method } as never, res as never, next);
  return { res, headers, next };
};

describe("portal route matching", () => {
  it.each([
    "/vendor-portal",
    "/vendor-portal/",
    "/vendor-portal/login",
    "/vendor-portal/assets/a.js",
  ])("matches %s", (url) => {
    expect(PORTAL_MATCHER.test(url)).toBe(true);
  });

  it.each([
    "/",
    "/vendor",
    "/vendor/me",
    "/vendorportal",
    "/vendor-portalx",
    "/admin",
    "/admin/vendor-portal",
    "/auth/vendor/emailpass",
  ])("does not match %s", (url) => {
    expect(PORTAL_MATCHER.test(url)).toBe(false);
  });

  it("never overlaps the vendor API chain", () => {
    expect(VENDOR_CHAIN_MATCHER.test("/vendor-portal/")).toBe(false);
    expect(VENDOR_CHAIN_MATCHER.test("/vendor/me")).toBe(true);
  });

  it("registers one unauthenticated middleware for GET and HEAD only", () => {
    expect(portalRouteEntries).toHaveLength(1);
    const [entry] = portalRouteEntries;
    expect(entry.matcher).toBe(PORTAL_MATCHER);
    expect(entry.method).toEqual(["GET", "HEAD"]);
    expect(entry.middlewares).toHaveLength(1);
  });
});

describe("resolvePortalTarget", () => {
  it.each([
    "/vendor-portal",
    "/vendor-portal/",
    "/vendor-portal/index.html?x=1",
    "/vendor-portal/login",
    "/vendor-portal/a/b/c",
  ])("answers the index or a file for %s", async (url) => {
    const target = await resolvePortalTarget(url, root);
    expect(target?.file.endsWith("index.html")).toBe(true);
  });

  it("returns an existing asset", async () => {
    const target = await resolvePortalTarget("/vendor-portal/assets/app.abc123.js", root);
    expect(target?.kind).toBe("asset");
  });

  it("returns null for a missing file with an extension", async () => {
    expect(await resolvePortalTarget("/vendor-portal/assets/missing.js", root)).toBeNull();
  });

  it.each([
    "/vendor-portal/../secret.txt",
    "/vendor-portal/assets/../../secret.txt",
    "/vendor-portal/%2e%2e/secret.txt",
    "/vendor-portal/%2E%2E%2Fsecret.txt",
    "/vendor-portal/..%2fsecret.txt",
    "/vendor-portal/%252e%252e/secret.txt",
    "/vendor-portal/assets/..%5csecret.txt",
    "/vendor-portal/a%00b",
    "/vendor-portal/%E0%A4%A",
    "/vendor-portalx/index.html",
    "/admin",
  ])("refuses %s", async (url) => {
    expect(await resolvePortalTarget(url, root)).toBeNull();
  });
});

describe("servePortal", () => {
  it("serves the index with no-store and the policy headers", async () => {
    const { res, headers, next } = await run("/vendor-portal/");
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('id="root"');
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["content-type"]).toContain("text/html");
    expect(headers["content-security-policy"]).toBe(PORTAL_CSP);
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(next).not.toHaveBeenCalled();
  });

  it("serves the SPA fallback for a deep link", async () => {
    const { res } = await run("/vendor-portal/agreement");
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('id="root"');
  });

  it("serves hashed assets as immutable", async () => {
    const { res, headers } = await run("/vendor-portal/assets/app.abc123.js");
    expect(res.statusCode).toBe(200);
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(headers["content-type"]).toContain("text/javascript");
  });

  it.each([
    "/vendor-portal/assets/missing.js",
    "/vendor-portal/../admin",
    "/vendor-portal/%2e%2e/admin",
    "/vendor-portal/%2E%2E%2Fadmin",
    "/vendor-portal/..%2fadmin",
    "/vendor-portal/%252e%252e/secret.txt",
  ])("answers 404 for %s without leaking the index or the secret", async (url) => {
    const { res, headers, next } = await run(url);
    expect(res.statusCode).toBe(404);
    expect(String(res.body)).not.toContain('id="root"');
    expect(String(res.body)).not.toContain("outside the root");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(next).not.toHaveBeenCalled();
  });

  it("sends no body for HEAD", async () => {
    const { res, headers } = await run("/vendor-portal/", "HEAD");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
    expect(Number(headers["content-length"])).toBeGreaterThan(0);
  });

  it("answers 404 when the portal has not been built", async () => {
    process.env.VENDOR_PORTAL_DIR = path.join(base, "not-built");
    try {
      const { res } = await run("/vendor-portal/");
      expect(res.statusCode).toBe(404);
    } finally {
      process.env.VENDOR_PORTAL_DIR = root;
    }
  });
});

describe("portal headers", () => {
  it("keeps scripts and framing locked down", () => {
    const script = PORTAL_CSP.split("; ").find((part) => part.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(PORTAL_CSP).toContain("default-src 'self'");
    expect(PORTAL_CSP).toContain("frame-ancestors 'none'");
    expect(PORTAL_CSP).not.toContain("unsafe-eval");
  });

  it("uses cache headers per kind", () => {
    expect(portalHeaders("index")["Cache-Control"]).toBe("no-store");
    expect(portalHeaders("file")["Cache-Control"]).toBe("no-cache");
    expect(portalHeaders("asset")["Cache-Control"]).toContain("immutable");
  });
});
