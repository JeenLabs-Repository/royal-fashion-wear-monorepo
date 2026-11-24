import { randomBytes } from "node:crypto";
import {
  assertProductionConfig,
  collectConfigIssues,
  MIN_SECRET_LENGTH,
  REQUIRED_SECRET_KEYS,
  warnWeakConfig,
} from "../production-config";

type Env = Record<string, string | undefined>;

const SECRET_KEYS = [
  "JWT_SECRET",
  "COOKIE_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "AUTH_MFA_ENCRYPTION_KEY",
  "REVALIDATE_SECRET",
];

const hex = (bytes = 32) => randomBytes(bytes).toString("hex");

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
  BREAK_GLASS_ALERT_EMAILS: "owner@example.test",
  VENDOR_PORTAL_URL: "https://backend.example.test/vendor-portal",
});

const without = (env: Env, key: string): Env => {
  const copy = { ...env };
  delete copy[key];
  return copy;
};

const messageOf = (env: Env): string | undefined => {
  try {
    assertProductionConfig(env);
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
};

describe("assertProductionConfig", () => {
  test("a fully valid production environment passes with no issues", () => {
    const env = validProductionEnv();
    expect(collectConfigIssues(env)).toEqual([]);
    expect(() => assertProductionConfig(env)).not.toThrow();
  });

  test("the MFA key is one of the required secrets", () => {
    expect(REQUIRED_SECRET_KEYS).toContain("AUTH_MFA_ENCRYPTION_KEY");
  });

  describe.each(SECRET_KEYS)("%s", (key) => {
    test("unset throws and names the key", () => {
      const env = without(validProductionEnv(), key);
      expect(() => assertProductionConfig(env)).toThrow(
        /^Refusing to start in production:/
      );
      expect(messageOf(env)).toContain(key);
    });

    test("the starter's old weak default throws and names the key", () => {
      const env = { ...validProductionEnv(), [key]: "supersecret" };
      expect(messageOf(env)).toContain(key);
    });

    test("replace-me throws and names the key", () => {
      const env = { ...validProductionEnv(), [key]: "replace-me" };
      expect(messageOf(env)).toContain(key);
    });

    test("a dev-only value throws and names the key", () => {
      const env = { ...validProductionEnv(), [key]: `dev-only-${hex(20)}` };
      expect(messageOf(env)).toContain(key);
    });

    test("a 31 character value throws and names the key", () => {
      const env = { ...validProductionEnv(), [key]: "a1".repeat(15) + "b" };
      expect(env[key]).toHaveLength(MIN_SECRET_LENGTH - 1);
      expect(messageOf(env)).toContain(key);
    });

    test("a 32 character value passes", () => {
      const env = { ...validProductionEnv(), [key]: "a1".repeat(16) };
      expect(env[key]).toHaveLength(MIN_SECRET_LENGTH);
      expect(() => assertProductionConfig(env)).not.toThrow();
    });

    test("the error text never contains the value", () => {
      const leaky = `tok_${hex(14).slice(0, MIN_SECRET_LENGTH - 5)}`;
      expect(leaky).toHaveLength(MIN_SECRET_LENGTH - 1);
      const message = messageOf({ ...validProductionEnv(), [key]: leaky });
      expect(message).toContain(key);
      expect(message).not.toContain(leaky);
    });
  });

  describe("COOKIE_SECURE", () => {
    test("false throws and names the variable", () => {
      const env = { ...validProductionEnv(), COOKIE_SECURE: "false" };
      expect(messageOf(env)).toContain("COOKIE_SECURE");
    });

    test("true passes", () => {
      const env = { ...validProductionEnv(), COOKIE_SECURE: "true" };
      expect(() => assertProductionConfig(env)).not.toThrow();
    });

    test("unset passes", () => {
      const env = without(validProductionEnv(), "COOKIE_SECURE");
      expect(() => assertProductionConfig(env)).not.toThrow();
    });
  });

  describe("required connection settings", () => {
    test("REDIS_URL unset throws and names the variable", () => {
      expect(messageOf(without(validProductionEnv(), "REDIS_URL"))).toContain(
        "REDIS_URL"
      );
    });

    test("DATABASE_URL unset throws and names the variable", () => {
      expect(
        messageOf(without(validProductionEnv(), "DATABASE_URL"))
      ).toContain("DATABASE_URL");
    });

    test("STOREFRONT_URL unset throws and names the variable", () => {
      expect(
        messageOf(without(validProductionEnv(), "STOREFRONT_URL"))
      ).toContain("STOREFRONT_URL");
    });

    test("STOREFRONT_URL that is not a URL throws", () => {
      const env = { ...validProductionEnv(), STOREFRONT_URL: "not a url" };
      expect(messageOf(env)).toContain("STOREFRONT_URL");
    });

    test("STOREFRONT_URL on the template vendor's host throws", () => {
      const env = {
        ...validProductionEnv(),
        STOREFRONT_URL: "https://demo.gorgojs.com",
      };
      expect(messageOf(env)).toContain("STOREFRONT_URL");
    });
  });

  describe.each(["STORE_CORS", "ADMIN_CORS", "AUTH_CORS"])("%s", (key) => {
    test("unset throws and names the variable", () => {
      expect(messageOf(without(validProductionEnv(), key))).toContain(key);
    });

    test("a list containing the Medusa docs site throws", () => {
      const env = {
        ...validProductionEnv(),
        [key]: "https://shop.example.test,https://docs.medusajs.com",
      };
      expect(messageOf(env)).toContain(key);
    });
  });

  test("a CORS list with only the store's own origins passes", () => {
    const env = {
      ...validProductionEnv(),
      STORE_CORS: "http://localhost:8000,https://shop.example.test",
    };
    expect(() => assertProductionConfig(env)).not.toThrow();
  });

  describe("GORGO_DISABLE_TELEMETRY", () => {
    test("unset throws and names the variable", () => {
      const env = without(validProductionEnv(), "GORGO_DISABLE_TELEMETRY");
      expect(messageOf(env)).toContain("GORGO_DISABLE_TELEMETRY");
    });

    test("false throws and names the variable", () => {
      const env = {
        ...validProductionEnv(),
        GORGO_DISABLE_TELEMETRY: "false",
      };
      expect(messageOf(env)).toContain("GORGO_DISABLE_TELEMETRY");
    });

    test("true passes", () => {
      const env = {
        ...validProductionEnv(),
        GORGO_DISABLE_TELEMETRY: "true",
      };
      expect(() => assertProductionConfig(env)).not.toThrow();
    });
  });

  describe("BREAK_GLASS_ALERT_EMAILS", () => {
    test("BREAK_GLASS_ALERT_EMAILS unset throws and names the variable", () => {
      const env = without(validProductionEnv(), "BREAK_GLASS_ALERT_EMAILS");
      expect(() => assertProductionConfig(env)).toThrow(/^Refusing to start in production:/);
      expect(messageOf(env)).toContain("BREAK_GLASS_ALERT_EMAILS");
    });

    test("BREAK_GLASS_ALERT_EMAILS empty or blank throws", () => {
      for (const value of ["", "   ", " , "]) {
        const env = { ...validProductionEnv(), BREAK_GLASS_ALERT_EMAILS: value };
        expect(messageOf(env)).toContain("BREAK_GLASS_ALERT_EMAILS");
      }
    });

    test("BREAK_GLASS_ALERT_EMAILS with an invalid address throws and never prints the value", () => {
      const bad = "not-an-address";
      const env = { ...validProductionEnv(), BREAK_GLASS_ALERT_EMAILS: `owner@example.test,${bad}` };
      const message = messageOf(env);
      expect(message).toContain("BREAK_GLASS_ALERT_EMAILS");
      expect(message).not.toContain(bad);
      expect(message).not.toContain("owner@example.test");
    });

    test("BREAK_GLASS_ALERT_EMAILS with two valid addresses passes", () => {
      const env = {
        ...validProductionEnv(),
        BREAK_GLASS_ALERT_EMAILS: "owner@example.test, second@example.test",
      };
      expect(collectConfigIssues(env)).toEqual([]);
      expect(() => assertProductionConfig(env)).not.toThrow();
    });

    test("BREAK_GLASS_ALERT_EMAILS is not checked outside production", () => {
      expect(() => assertProductionConfig({ NODE_ENV: "development" })).not.toThrow();
    });
  });

  describe("VENDOR_PORTAL_URL", () => {
    test("unset throws and names the variable", () => {
      expect(messageOf(without(validProductionEnv(), "VENDOR_PORTAL_URL"))).toContain(
        "VENDOR_PORTAL_URL"
      );
    });

    test("an http URL throws and names the variable", () => {
      const env = {
        ...validProductionEnv(),
        VENDOR_PORTAL_URL: "http://backend.example.test/vendor-portal",
      };
      expect(messageOf(env)).toContain("VENDOR_PORTAL_URL");
    });

    test("an https URL without the base path throws and names the variable", () => {
      const env = { ...validProductionEnv(), VENDOR_PORTAL_URL: "https://backend.example.test" };
      expect(messageOf(env)).toContain("VENDOR_PORTAL_URL");
    });

    test("a value that is not a URL throws and names the variable", () => {
      const env = { ...validProductionEnv(), VENDOR_PORTAL_URL: "not a url" };
      expect(messageOf(env)).toContain("VENDOR_PORTAL_URL");
    });

    test("an https URL with the base path passes", () => {
      const env = {
        ...validProductionEnv(),
        VENDOR_PORTAL_URL: "https://backend.example.test/vendor-portal",
      };
      expect(() => assertProductionConfig(env)).not.toThrow();
    });

    test("a trailing slash after the base path passes", () => {
      const env = {
        ...validProductionEnv(),
        VENDOR_PORTAL_URL: "https://backend.example.test/vendor-portal/",
      };
      expect(() => assertProductionConfig(env)).not.toThrow();
    });
  });

  test("several broken values at once produce one error naming every key", () => {
    const env = {
      ...without(validProductionEnv(), "JWT_SECRET"),
      COOKIE_SECRET: "replace-me",
      REDIS_URL: undefined,
      COOKIE_SECURE: "false",
    };
    const message = messageOf(env) ?? "";
    for (const key of [
      "JWT_SECRET",
      "COOKIE_SECRET",
      "REDIS_URL",
      "COOKIE_SECURE",
    ]) {
      expect(message).toContain(key);
    }
    expect(message.match(/Refusing to start in production/g)).toHaveLength(1);
  });

  describe.each(["development", "test", undefined])(
    "NODE_ENV %s",
    (nodeEnv) => {
      test("does not throw, even with nothing set", () => {
        expect(() =>
          assertProductionConfig({ NODE_ENV: nodeEnv })
        ).not.toThrow();
      });
    }
  );
});

describe("warnWeakConfig", () => {
  test("reports placeholder and short secrets in development through the logger", () => {
    const warn = jest.fn();
    warnWeakConfig(
      {
        NODE_ENV: "development",
        JWT_SECRET: "replace-me",
        COOKIE_SECRET: "short",
      },
      warn
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line.startsWith("[config]")).toBe(true);
    expect(line).toContain("JWT_SECRET");
    expect(line).toContain("COOKIE_SECRET");
  });

  test("stays quiet when the secrets are strong", () => {
    const warn = jest.fn();
    warnWeakConfig(
      { ...validProductionEnv(), NODE_ENV: "development" },
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test("stays quiet in production, where the assertion is the gate", () => {
    const warn = jest.fn();
    warnWeakConfig(
      { NODE_ENV: "production", JWT_SECRET: "replace-me" },
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
