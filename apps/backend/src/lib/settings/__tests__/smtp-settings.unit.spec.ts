jest.mock("../resolve-options", () => {
  const actual = jest.requireActual("../resolve-options");
  return { ...actual, fetchResolvedOptions: jest.fn() };
});

import * as resolveOptions from "../resolve-options";
import {
  SMTP_DEFAULTS,
  getSmtpSettings,
  resetSmtpFallbackNoticeForTests,
} from "../smtp";

const fetchMock = resolveOptions.fetchResolvedOptions as jest.Mock;

const ENV_KEYS = [
  "NODE_ENV",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_REPLY_TO",
  "STORE_NAME",
];

let saved: Record<string, string | undefined> = {};

const setEnv = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
};

const makeContainer = () => {
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    logger,
    container: {
      resolve: (key: string) => (key === "logger" ? logger : undefined),
    },
  };
};

const cardOptions = {
  host: "smtp.card.test",
  port: 465,
  secure: true,
  user: "card-user",
  pass: "card-pass",
  from: "shop@card.test",
  from_name: "Card Shop",
  reply_to: "help@card.test",
};

const devEnv = {
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "",
  SMTP_PASS: "dev-pass",
  SMTP_FROM: "dev@example.test",
  SMTP_REPLY_TO: "reply@example.test",
  STORE_NAME: "Dev Store",
};

const unsaved = { status: "unavailable", reason: "unsaved" };

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  fetchMock.mockReset();
  resetSmtpFallbackNoticeForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("getSmtpSettings", () => {
  it("uses the card in production and ignores the environment", async () => {
    setEnv({ NODE_ENV: "production", ...devEnv });
    fetchMock.mockResolvedValue({ status: "resolved", options: cardOptions });
    const { container } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.source).toBe("card");
    expect(result.settings).toEqual(cardOptions);
  });

  it("returns the defaults in production when the card is unsaved, never reading the environment", async () => {
    setEnv({ NODE_ENV: "production", ...devEnv });
    fetchMock.mockResolvedValue(unsaved);
    const { container } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.source).toBe("none");
    expect(result.settings).toEqual(SMTP_DEFAULTS);
  });

  it("returns the defaults in production when the card has no host", async () => {
    setEnv({ NODE_ENV: "production", ...devEnv });
    fetchMock.mockResolvedValue({
      status: "resolved",
      options: { ...cardOptions, host: "" },
    });
    const { container } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.source).toBe("none");
    expect(result.settings.host).toBe("");
  });

  it.each(["development", "test"])(
    "falls back to the environment in %s when the card is unconfigured",
    async (nodeEnv) => {
      setEnv({ NODE_ENV: nodeEnv, ...devEnv });
      fetchMock.mockResolvedValue(unsaved);
      const { container } = makeContainer();

      const result = await getSmtpSettings(container);

      expect(result.source).toBe("dev-env");
      expect(result.settings).toEqual({
        host: "127.0.0.1",
        port: 1025,
        secure: false,
        user: "",
        pass: "dev-pass",
        from: "dev@example.test",
        from_name: "Dev Store",
        reply_to: "reply@example.test",
      });
    }
  );

  it("lets a configured card win over the environment in development", async () => {
    setEnv({ NODE_ENV: "development", ...devEnv });
    fetchMock.mockResolvedValue({ status: "resolved", options: cardOptions });
    const { container } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.source).toBe("card");
    expect(result.settings.host).toBe("smtp.card.test");
  });

  it("falls back to the default port and warns when the stored port is out of range", async () => {
    setEnv({ NODE_ENV: "production" });
    fetchMock.mockResolvedValue({
      status: "resolved",
      options: { ...cardOptions, port: 70000 },
    });
    const { container, logger } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.settings.port).toBe(587);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[smtp\] port/)
    );
  });

  it("falls back to the default and warns when secure is not a boolean", async () => {
    setEnv({ NODE_ENV: "production" });
    fetchMock.mockResolvedValue({
      status: "resolved",
      options: { ...cardOptions, secure: "yes" },
    });
    const { container, logger } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.settings.secure).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[smtp\] secure/)
    );
  });

  it("returns different values for different containers because nothing is cached", async () => {
    setEnv({ NODE_ENV: "production" });
    fetchMock
      .mockResolvedValueOnce({ status: "resolved", options: cardOptions })
      .mockResolvedValueOnce({
        status: "resolved",
        options: { ...cardOptions, host: "smtp.other.test" },
      });

    const first = await getSmtpSettings(makeContainer().container);
    const second = await getSmtpSettings(makeContainer().container);

    expect(first.settings.host).toBe("smtp.card.test");
    expect(second.settings.host).toBe("smtp.other.test");
  });

  it("logs the development fallback once per process with the host only", async () => {
    setEnv({ NODE_ENV: "development", ...devEnv });
    fetchMock.mockResolvedValue(unsaved);
    const { container, logger } = makeContainer();

    await getSmtpSettings(container);
    await getSmtpSettings(container);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = String(logger.warn.mock.calls[0][0]);
    expect(line).toContain("127.0.0.1");
    expect(line).not.toContain("dev-pass");
  });

  it("keeps the stored password exactly, spaces included", async () => {
    setEnv({ NODE_ENV: "production" });
    fetchMock.mockResolvedValue({
      status: "resolved",
      options: { ...cardOptions, pass: "  spaced pass  " },
    });
    const { container } = makeContainer();

    const result = await getSmtpSettings(container);

    expect(result.settings.pass).toBe("  spaced pass  ");
  });
});
