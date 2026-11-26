import fs from "node:fs";
import path from "node:path";
import { STATES } from "../states";

type Row = { code: string; name: string; gst: string };

const REGISTRY = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../../config/plugin-registry.json"),
    "utf8"
  )
) as { repos: Record<string, { package: string }> };

const SETTINGS_PACKAGE = REGISTRY.repos["medusa-store-settings"].package;

function fromApp(): Row[] {
  return STATES.map((s) => ({
    code: s.code,
    name: s.name,
    gst: s.gst_code,
  }));
}

async function fromPlugin(): Promise<Row[]> {
  const mod = (await import(`${SETTINGS_PACKAGE}/public`)) as {
    INDIA_STATE_OPTIONS: Array<{ code: string; name: string; gst_code: string }>;
  };
  return mod.INDIA_STATE_OPTIONS.map((s) => ({
    code: s.code,
    name: s.name,
    gst: String(s.gst_code),
  }));
}

const byCode = (a: Row, b: Row) => a.code.localeCompare(b.code);

describe("state table parity between the settings plugin and the application", () => {
  it("lists the same codes", async () => {
    const plugin = (await fromPlugin()).map((r) => r.code).sort();
    const app = fromApp()
      .map((r) => r.code)
      .sort();
    expect(plugin).toEqual(app);
  });

  it("uses the same names", async () => {
    const plugin = (await fromPlugin()).sort(byCode);
    const app = fromApp().sort(byCode);
    expect(plugin.map((r) => [r.code, r.name])).toEqual(
      app.map((r) => [r.code, r.name])
    );
  });

  it("uses the same GST codes", async () => {
    const plugin = (await fromPlugin()).sort(byCode);
    const app = fromApp().sort(byCode);
    expect(plugin.map((r) => [r.code, r.gst])).toEqual(
      app.map((r) => [r.code, r.gst])
    );
  });

  it("holds 36 entries in each table", async () => {
    expect((await fromPlugin()).length).toBe(36);
    expect(fromApp().length).toBe(36);
  });

  it("uses the ISO codes Medusa validates for Telangana and Chhattisgarh", async () => {
    for (const rows of [await fromPlugin(), fromApp()]) {
      const codes = rows.map((r) => r.code);
      expect(codes).toContain("IN-TG");
      expect(codes).toContain("IN-CT");
      expect(codes).not.toContain("IN-TS");
      expect(codes).not.toContain("IN-CG");
    }
  });
});
