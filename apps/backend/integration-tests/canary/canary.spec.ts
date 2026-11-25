import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { exercisedReport, assertAllExercised, listSurfaces, type CanaryManifest, type SurfaceContext } from "./surfaces/registry";
import { missingCategories } from "./surfaces/categories";
import { runSurface } from "./run";
import { formatFinding } from "./scan";
import "./surfaces";

// Plain HTTP crawl of a built backend and a built storefront. Start both with
// `sh scripts/run-canary.sh` (it seeds, builds, starts and runs this file).
const manifestPath =
  process.env.CANARY_MANIFEST ?? path.resolve(__dirname, "..", "..", "..", "..", "e2e", ".auth", "canary-seed.json");

const buildContext = (): SurfaceContext => {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `The canary seed manifest is missing at ${manifestPath}. Run the seed first: pnpm -C apps/backend exec medusa exec ./src/scripts/seed-canary.ts`
    );
  }
  return {
    backendUrl: process.env.CANARY_BACKEND_URL ?? "http://localhost:9000",
    storefrontUrl: process.env.CANARY_STOREFRONT_URL ?? "http://localhost:8000",
    locale: process.env.CANARY_LOCALE ?? "en",
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as CanaryManifest,
    manifestPath,
  };
};

describe("anonymity canary crawl", () => {
  for (const surface of listSurfaces()) {
    it(`surface ${surface.id} shows no vendor strings`, async () => {
      const result = await runSurface(surface, buildContext());
      expect(result.failures).toEqual([]);
      expect(result.findings.map(formatFinding)).toEqual([]);
    }, 300_000);
  }

  it("exercised every registered surface", () => {
    console.info(JSON.stringify(exercisedReport(), null, 2));
    console.info(
      `[canary] kinds still without a surface: ${missingCategories(listSurfaces().map((surface) => surface.kind)).join(", ")}`
    );
    assertAllExercised();
  });
});
