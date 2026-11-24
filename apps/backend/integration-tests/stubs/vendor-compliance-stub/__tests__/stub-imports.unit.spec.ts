import { readFileSync } from "node:fs";
import path from "node:path";

const stubSource = readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");

const specifiers = [...stubSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

describe("the stub plugin imports", () => {
  test("take backend code only from the public surface", () => {
    const backendImports = specifiers.filter((specifier) => specifier.includes("src/"));
    expect(backendImports.length).toBeGreaterThan(0);
    for (const specifier of backendImports) {
      expect(specifier).toMatch(/modules\/vendor\/public$/);
    }
  });

  test("use no other relative path", () => {
    const relative = specifiers.filter((specifier) => specifier.startsWith("."));
    expect(relative.every((specifier) => specifier.endsWith("modules/vendor/public"))).toBe(true);
  });

  test("use only the framework utilities besides the surface", () => {
    const packages = specifiers.filter((specifier) => !specifier.startsWith("."));
    expect(packages).toEqual(["@medusajs/framework/utils"]);
  });
});
