import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CANARY_VENDORS } from "../../../src/scripts/demo-data/canary";
import { runSurface } from "../run";
import type { Surface, SurfaceContext, SurfaceResponse } from "../surfaces/registry";

const alpha = CANARY_VENDORS.alpha;
const beta = CANARY_VENDORS.beta;

const routes: Record<string, { type: string; body: string; status?: number }> = {
  "/leak-html": { type: "text/html", body: `<html><body><p>${alpha.internal_name}</p></body></html>` },
  "/leak-rsc": {
    type: "text/x-component",
    body: `0:["$","div",null,{"children":"${alpha.note}"}]\n1:I["x"]\n`,
  },
  "/leak-jsonld": {
    type: "text/html",
    body: `<html><script type="application/ld+json">{"@type":"Product","brand":{"name":"${alpha.location.city}"}}</script></html>`,
  },
  "/leak-json": {
    type: "application/json",
    body: JSON.stringify({ product: { metadata: { supplier: beta.contact_name } } }),
  },
  "/clean": { type: "text/html", body: "<html><body>Ships from Karnataka</body></html>" },
  "/boom": { type: "text/html", body: "<html>clean but broken</html>", status: 500 },
};

let server: Server;
let base = "";

const context = {} as SurfaceContext;

const fetchAll = (paths: string[]) => async (): Promise<SurfaceResponse[]> =>
  Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${base}${path}`);
      return {
        url: `${base}${path}`,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: await response.text(),
      };
    })
  );

const surfaceFor = (id: string, paths: string[]): Surface => ({
  id,
  kind: "store-api",
  owner: "tests",
  description: "Tripwire surface",
  minRequests: 1,
  collect: fetchAll(paths),
});

beforeAll(async () => {
  server = createServer((request, response) => {
    const route = routes[request.url ?? ""];
    if (!route) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(route.status ?? 200, { "content-type": route.type }).end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the canary pipeline detects a leak", () => {
  it("reports a vendor name leaked in HTML", async () => {
    const result = await runSurface(surfaceFor("tripwire-html", ["/leak-html"]), context);
    expect(result.findings.map((finding) => finding.token)).toContain(alpha.internal_name);
    expect(result.findings[0].url).toBe(`${base}/leak-html`);
  });

  it("reports a vendor note leaked in an RSC-style chunk", async () => {
    const result = await runSurface(surfaceFor("tripwire-rsc", ["/leak-rsc"]), context);
    expect(result.findings.map((finding) => finding.token)).toContain(alpha.note);
  });

  it("reports a vendor city leaked inside JSON-LD", async () => {
    const result = await runSurface(surfaceFor("tripwire-jsonld", ["/leak-jsonld"]), context);
    expect(result.findings.map((finding) => finding.token)).toContain(alpha.location.city);
  });

  it("reports a vendor contact leaked in a JSON metadata field", async () => {
    const result = await runSurface(surfaceFor("tripwire-json", ["/leak-json"]), context);
    expect(result.findings.map((finding) => finding.token)).toContain(beta.contact_name);
  });

  it("reports nothing for clean responses but fails a clean 500", async () => {
    const clean = await runSurface(surfaceFor("tripwire-clean", ["/clean"]), context);
    expect(clean.findings).toEqual([]);
    expect(clean.failures).toEqual([]);

    const broken = await runSurface(surfaceFor("tripwire-boom", ["/boom"]), context);
    expect(broken.findings).toEqual([]);
    expect(broken.failures).toHaveLength(1);
    expect(broken.failures[0]).toContain("returned 500");
  });
});
