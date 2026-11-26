import fs from "node:fs";
import path from "node:path";

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "../..");

type Descriptors = {
  plugins: Record<string, string[]>;
  ownProviders: Record<string, string[]>;
};

type AdoptionInput = {
  resolves: string[];
  descriptors: Descriptors;
  exempt: string[];
  resolvable: (resolve: string) => boolean;
};

const PROVIDER_PATTERN = /\/providers\/(integration-[a-z0-9-]+)$/;

function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8")) as T;
}

// Every string stored under a `resolve` key, at any depth. This does not depend on
// how defineConfig arranges plugins and modules, only on the `resolve` key name.
function collectResolves(
  node: unknown,
  found: string[] = [],
  seen = new WeakSet<object>()
): string[] {
  if (!node || typeof node !== "object") return found;
  if (seen.has(node as object)) return found;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (const item of node) collectResolves(item, found, seen);
    return found;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "resolve" && typeof value === "string") found.push(value);
    else collectResolves(value, found, seen);
  }
  return found;
}

// Returns the package name for a third-party resolve path, or null for relative
// paths and for the framework's own packages.
function thirdPartyPackage(resolve: string): string | null {
  if (resolve.startsWith(".") || path.isAbsolute(resolve)) return null;
  const parts = resolve.split("/");
  const name = resolve.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return name.startsWith("@medusajs/") ? null : name;
}

function registeredIdentifiers(resolves: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const resolve of resolves) {
    const match = PROVIDER_PATTERN.exec(resolve);
    if (match) map.set(match[1], resolve);
  }
  return map;
}

function findAdoptionProblems(input: AdoptionInput): string[] {
  const problems: string[] = [];
  const registered = registeredIdentifiers(input.resolves);
  const packages = new Set<string>();

  for (const resolve of input.resolves) {
    const name = thirdPartyPackage(resolve);
    if (name && !input.exempt.includes(name)) packages.add(name);
  }

  for (const name of packages) {
    const mapped = input.descriptors.plugins[name];
    if (!mapped) {
      problems.push(
        `package ${name} has no wrapper descriptor mapped and is not exempt`
      );
      continue;
    }
    for (const identifier of mapped) {
      if (!registered.has(identifier)) {
        problems.push(
          `descriptor ${identifier} mapped for ${name} is not registered`
        );
      }
    }
  }

  for (const [identifier, resolve] of registered) {
    if (!input.resolvable(resolve)) {
      problems.push(
        `provider path ${resolve} for ${identifier} does not resolve`
      );
    }
  }

  for (const [own, identifiers] of Object.entries(
    input.descriptors.ownProviders
  )) {
    if (!input.resolves.includes(own)) {
      problems.push(
        `own provider ${own} is mapped but not registered in the configuration`
      );
      continue;
    }
    for (const identifier of identifiers) {
      if (!registered.has(identifier)) {
        problems.push(
          `own provider ${own} needs descriptor ${identifier}, which is not registered`
        );
      }
    }
  }

  return problems;
}

function realResolvable(resolve: string): boolean {
  try {
    require.resolve(resolve, { paths: [BACKEND_ROOT] });
    return true;
  } catch {
    return false;
  }
}

function loadRealConfig(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(path.join(BACKEND_ROOT, "medusa-config"));
  return loaded && loaded.default ? loaded.default : loaded;
}

const descriptors = readJson<Descriptors>("config/plugin-descriptors.json");
const exempt = readJson<{ exempt: string[] }>(
  "config/descriptor-exempt.json"
).exempt;
const registry = readJson<{
  repos: Record<string, { package: string; planned?: boolean }>;
}>("config/plugin-registry.json");

const SETTINGS_PACKAGE = registry.repos["medusa-store-settings"].package;
const RAZORPAY_PACKAGE = registry.repos["medusa-payment-razorpay"].package;

function baseInput(overrides: Partial<AdoptionInput> = {}): AdoptionInput {
  return {
    resolves: [
      RAZORPAY_PACKAGE,
      SETTINGS_PACKAGE,
      `${RAZORPAY_PACKAGE}/providers/razorpay`,
      `${RAZORPAY_PACKAGE}/providers/integration-razorpay`,
      `${SETTINGS_PACKAGE}/providers/integration-gst-invoicing`,
      `${SETTINGS_PACKAGE}/providers/integration-smtp`,
      `${SETTINGS_PACKAGE}/providers/integration-vendor-onboarding`,
      "@gorgo/medusa-integration",
      "@medusajs/medusa/payment",
      "./src/modules/smtp-notification",
    ],
    descriptors,
    exempt,
    resolvable: () => true,
    ...overrides,
  };
}

describe("adopted plugins carry wrapper descriptors", () => {
  it("passes for the real configuration", () => {
    const config = loadRealConfig();
    const resolves = collectResolves(config);
    expect(resolves.length).toBeGreaterThan(5);
    const problems = findAdoptionProblems({
      resolves,
      descriptors,
      exempt,
      resolvable: realResolvable,
    });
    expect(problems).toEqual([]);
  });

  it("fails and names a third-party plugin that has no map entry", () => {
    const problems = findAdoptionProblems(
      baseInput({ resolves: [...baseInput().resolves, "some-new-plugin"] })
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("some-new-plugin");
  });

  it("fails and names a mapped identifier that is not registered", () => {
    const resolves = baseInput().resolves.filter(
      (r) => !r.endsWith("integration-gst-invoicing")
    );
    const problems = findAdoptionProblems(baseInput({ resolves }));
    expect(
      problems.some((p) => p.includes("integration-gst-invoicing"))
    ).toBe(true);
  });

  it("fails and names a registered provider path that does not resolve", () => {
    const problems = findAdoptionProblems(
      baseInput({
        resolvable: (resolve) => !resolve.endsWith("integration-smtp"),
      })
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("integration-smtp");
  });

  it("does not treat framework packages or relative paths as third party", () => {
    expect(thirdPartyPackage("@medusajs/medusa/payment")).toBeNull();
    expect(thirdPartyPackage("@medusajs/medusa")).toBeNull();
    expect(thirdPartyPackage("./src/modules/smtp-notification")).toBeNull();
    expect(thirdPartyPackage("../shared/thing")).toBeNull();
  });

  it("extracts the package name from scoped and unscoped paths", () => {
    expect(thirdPartyPackage("@acme/plugin/providers/thing")).toBe(
      "@acme/plugin"
    );
    expect(thirdPartyPackage("@acme/plugin")).toBe("@acme/plugin");
    expect(thirdPartyPackage("plain-plugin/sub/path")).toBe("plain-plugin");
    expect(thirdPartyPackage("plain-plugin")).toBe("plain-plugin");
  });

  it("requires the app's own mail provider to map to a registered card", () => {
    const resolves = baseInput().resolves.filter(
      (r) => !r.endsWith("integration-smtp")
    );
    const problems = findAdoptionProblems(baseInput({ resolves }));
    expect(
      problems.some((p) => p.includes("./src/modules/smtp-notification"))
    ).toBe(true);
  });

  it("flags a mapped own provider that the configuration no longer registers", () => {
    const resolves = baseInput().resolves.filter(
      (r) => r !== "./src/modules/smtp-notification"
    );
    const problems = findAdoptionProblems(baseInput({ resolves }));
    expect(
      problems.some((p) => p.includes("is mapped but not registered"))
    ).toBe(true);
  });

  it("lets an exempt package pass without a map entry", () => {
    const problems = findAdoptionProblems(baseInput());
    expect(problems).toEqual([]);
  });

  it("holds exactly the Integration Module in the exempt file", () => {
    expect(exempt).toEqual(["@gorgo/medusa-integration"]);
  });

  it("keeps the map keys equal to the registry packages", () => {
    const registryPackages = Object.values(registry.repos)
      .filter((repo) => !repo.planned)
      .map((repo) => repo.package)
      .sort();
    expect(Object.keys(descriptors.plugins).sort()).toEqual(registryPackages);
  });

  it("maps each first-party plugin to its card identifiers", () => {
    expect(descriptors.plugins[RAZORPAY_PACKAGE]).toEqual([
      "integration-razorpay",
    ]);
    expect([...descriptors.plugins[SETTINGS_PACKAGE]].sort()).toEqual([
      "integration-gst-invoicing",
      "integration-smtp",
      "integration-vendor-onboarding",
    ]);
  });

  it("finds resolve paths nested inside module and plugin options", () => {
    const config = {
      plugins: [
        {
          resolve: "a-plugin",
          options: {
            providers: [{ resolve: "a-plugin/providers/integration-x" }],
          },
        },
      ],
      modules: [
        {
          resolve: "@medusajs/medusa/payment",
          options: { providers: [{ resolve: "b/providers/p" }] },
        },
      ],
    };
    expect(collectResolves(config).sort()).toEqual(
      [
        "@medusajs/medusa/payment",
        "a-plugin",
        "a-plugin/providers/integration-x",
        "b/providers/p",
      ].sort()
    );
  });
});
