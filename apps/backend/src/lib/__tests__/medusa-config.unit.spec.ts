import { randomBytes } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DEV_FALLBACK_SECRET } from "../production-config";

type Env = Record<string, string | undefined>;

// Everything medusa-config.ts reads, so each case starts from a clean slate and
// nothing from the developer's shell or a stray env file leaks in.
const CONFIG_KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "COOKIE_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "AUTH_MFA_ENCRYPTION_KEY",
  "REVALIDATE_SECRET",
  "COOKIE_SECURE",
  "REDIS_URL",
  "CACHE_REDIS_URL",
  "USE_REDIS",
  "DATABASE_URL",
  "DATABASE_SSL",
  "DATABASE_SSL_REJECT_UNAUTHORIZED",
  "STOREFRONT_URL",
  "STORE_CORS",
  "ADMIN_CORS",
  "AUTH_CORS",
  "GORGO_DISABLE_TELEMETRY",
  "SMTP_HOST",
  "S3_BUCKET",
];

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_ARGV = [...process.argv];
const BACKEND_ROOT = join(__dirname, "../../..");
// loadEnv always reads `.env` (and `.env.<NODE_ENV>` for known envs). Park them
// so a developer's local values cannot leak into these cases.
const ENV_FILES = [".env", ".env.test", ".env.production", ".env.staging"];

const hex = () => randomBytes(32).toString("hex");

const validProductionEnv = (): Env => ({
  NODE_ENV: "production",
  JWT_SECRET: hex(),
  COOKIE_SECRET: hex(),
  INTEGRATION_ENCRYPTION_KEY: hex(),
  AUTH_MFA_ENCRYPTION_KEY: hex(),
  REVALIDATE_SECRET: hex(),
  REDIS_URL: "redis://redis:6379",
  DATABASE_URL: "postgres://app:app@db.internal:5432/store",
  STOREFRONT_URL: "https://shop.example.test",
  STORE_CORS: "https://shop.example.test",
  ADMIN_CORS: "https://admin.example.test",
  AUTH_CORS: "https://shop.example.test,https://admin.example.test",
  GORGO_DISABLE_TELEMETRY: "true",
});

const withEnvFilesParked = <T>(run: () => T): T => {
  const parked: Array<{ from: string; to: string }> = [];
  for (const name of ENV_FILES) {
    const from = join(BACKEND_ROOT, name);
    if (!existsSync(from)) {
      continue;
    }
    const to = `${from}.jest-parked`;
    renameSync(from, to);
    parked.push({ from, to });
  }
  try {
    return run();
  } finally {
    for (const { from, to } of parked) {
      if (existsSync(to)) {
        renameSync(to, from);
      }
    }
  }
};

// Loads medusa-config.ts the way the Medusa CLI does: once, with the process
// environment and the command already in place.
const loadConfig = (env: Env, command = "start") => {
  const cleaned: Env = { ...ORIGINAL_ENV };
  for (const key of CONFIG_KEYS) {
    delete cleaned[key];
  }
  process.env = { ...cleaned, ...env } as NodeJS.ProcessEnv;
  process.argv = ["node", "medusa", command];

  let config: any;
  withEnvFilesParked(() => {
    jest.isolateModules(() => {
      config = require("../../../medusa-config");
    });
  });
  return config;
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.argv = [...ORIGINAL_ARGV];
  jest.restoreAllMocks();
});

// Outside production every NODE_ENV takes the same path. "test" is used instead
// of "development" because loadEnv reads a developer's local .env for the
// development value, which would leak real values into these cases.
describe("medusa-config", () => {
  test("production with a weak signing secret refuses to load", () => {
    const env = { ...validProductionEnv(), JWT_SECRET: "supersecret" };
    expect(() => loadConfig(env)).toThrow(/Refusing to start in production/);
  });

  test("production with a valid environment uses the supplied secrets, secure cookies and Redis", () => {
    const env = validProductionEnv();
    const config = loadConfig(env);
    expect(config.projectConfig.http.jwtSecret).toBe(env.JWT_SECRET);
    expect(config.projectConfig.http.cookieSecret).toBe(env.COOKIE_SECRET);
    expect(config.projectConfig.cookieOptions.secure).toBe(true);
    expect(config.projectConfig.redisUrl).toBe(env.REDIS_URL);
  });

  test("production with no secrets still loads for the build command", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production" }, "build")
    ).not.toThrow();
  });

  test("outside production with no secrets loads and uses the development-only fallback", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = loadConfig({ NODE_ENV: "test" }, "develop");
    expect(config.projectConfig.http.jwtSecret).toBe(DEV_FALLBACK_SECRET);
    expect(config.projectConfig.http.cookieSecret).toBe(DEV_FALLBACK_SECRET);
    expect(config.projectConfig.cookieOptions.secure).toBe(false);
  });

  test("DATABASE_SSL=true gives an ssl object and leaving it unset keeps ssl off", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const on = loadConfig(
      { NODE_ENV: "test", DATABASE_SSL: "true" },
      "develop"
    );
    expect(on.projectConfig.databaseDriverOptions.connection.ssl).toEqual({
      rejectUnauthorized: true,
    });
    const off = loadConfig({ NODE_ENV: "test" }, "develop");
    expect(off.projectConfig.databaseDriverOptions.connection.ssl).toBe(false);
  });
});
