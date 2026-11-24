const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_ARGV = [...process.argv];

// Loads medusa-config.ts the way the Medusa CLI does, from a clean environment
// so nothing from a developer's shell or env file leaks in.
const loadConfig = () => {
  const env: NodeJS.ProcessEnv = { ...ORIGINAL_ENV, NODE_ENV: "test" };
  for (const key of ["REDIS_URL", "USE_REDIS", "SMTP_HOST", "S3_BUCKET"]) {
    delete env[key];
  }
  process.env = env;
  process.argv = ["node", "medusa", "develop"];

  let config: any;
  jest.isolateModules(() => {
    config = require("../../../../medusa-config");
  });
  return config;
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.argv = [...ORIGINAL_ARGV];
  jest.restoreAllMocks();
});

describe("session and token lifetimes", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("the dashboard session lasts 8 hours", () => {
    const config = loadConfig();
    expect(config.projectConfig.sessionOptions.ttl).toBe(28800000);
  });

  test("the bearer token lifetime is explicit and one day", () => {
    const config = loadConfig();
    expect(config.projectConfig.http.jwtExpiresIn).toBe("1d");
  });

  test("the staff access module is registered", () => {
    const config = loadConfig();
    const modules = config.modules as
      | { resolve?: string }[]
      | Record<string, { resolve?: string }>;
    const resolves = Array.isArray(modules)
      ? modules.map((entry) => entry.resolve)
      : Object.values(modules ?? {}).map((entry) => entry?.resolve);
    expect(resolves).toContain("./src/modules/staff-access");
    expect(Object.keys(modules ?? {})).toContain("staffAccess");
  });
});
