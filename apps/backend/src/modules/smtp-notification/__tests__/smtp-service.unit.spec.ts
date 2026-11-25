jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

jest.mock("../../../lib/settings/smtp", () => ({
  getSmtpSettings: jest.fn(),
}));

import nodemailer from "nodemailer";
import { getSmtpSettings } from "../../../lib/settings/smtp";
import {
  SmtpNotificationService,
  resetSmtpTransportCacheForTests,
} from "../services/smtp";

const createTransport = nodemailer.createTransport as unknown as jest.Mock;
const settingsMock = getSmtpSettings as jest.Mock;

const baseSettings = {
  host: "smtp.one.test",
  port: 587,
  secure: false,
  user: "mailer",
  pass: "s3cret-pass",
  from: "shop@example.test",
  from_name: "Example Shop",
  reply_to: "",
};

const withSettings = (overrides: Record<string, unknown> = {}) =>
  settingsMock.mockResolvedValue({
    settings: { ...baseSettings, ...overrides },
    source: "card",
  });

const notification = {
  to: "buyer@example.test",
  channel: "email",
  template: "test",
  content: { subject: "Hello", html: "<p>Hi</p>", text: "Hi" },
} as never;

let sendMail: jest.Mock;
let close: jest.Mock;
let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };

const makeService = () =>
  new SmtpNotificationService({ logger } as never, { channels: ["email"] });

beforeEach(() => {
  resetSmtpTransportCacheForTests();
  settingsMock.mockReset();
  sendMail = jest.fn(async () => ({ messageId: "msg-1" }));
  close = jest.fn();
  createTransport.mockReset();
  createTransport.mockImplementation(() => ({ sendMail, close }));
  logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

describe("SmtpNotificationService", () => {
  it("reads nothing in the constructor and sends later with settings that appear afterwards", async () => {
    const service = makeService();
    expect(settingsMock).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();

    withSettings();
    await service.send(notification);

    expect(settingsMock).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it("hands the settings reader something that resolves the logger", async () => {
    withSettings();
    await makeService().send(notification);

    const container = settingsMock.mock.calls[0][0] as {
      resolve: (key: string) => unknown;
    };
    expect(container.resolve("logger")).toBe(logger);
  });

  it("creates the transport once for equal settings", async () => {
    withSettings();
    const service = makeService();

    await service.send(notification);
    await service.send(notification);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("creates a new transport after the host or the password changes", async () => {
    const service = makeService();

    withSettings();
    await service.send(notification);
    withSettings({ host: "smtp.two.test" });
    await service.send(notification);
    withSettings({ host: "smtp.two.test", pass: "another-pass" });
    await service.send(notification);

    expect(createTransport).toHaveBeenCalledTimes(3);
  });

  it("logs and skips when no host is configured", async () => {
    withSettings({ host: "" });

    const result = await makeService().send(notification);

    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      "[smtp] not configured, skipping email"
    );
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("builds the From header from the display name and the address", async () => {
    const service = makeService();

    withSettings();
    await service.send(notification);
    expect(sendMail.mock.calls[0][0].from).toEqual({
      name: "Example Shop",
      address: "shop@example.test",
    });

    withSettings({ from: "Named <named@example.test>" });
    await service.send(notification);
    expect(sendMail.mock.calls[1][0].from).toBe("Named <named@example.test>");

    withSettings({ from: "", from_name: "" });
    await service.send(notification);
    expect(sendMail.mock.calls[2][0].from).toBe("mailer");
  });

  it("never logs the password, on success or on failure", async () => {
    const service = makeService();
    withSettings();
    await service.send(notification);

    sendMail.mockRejectedValueOnce(new Error("connection refused"));
    await expect(service.send(notification)).rejects.toThrow(
      "connection refused"
    );

    const everything = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(everything).not.toContain("s3cret-pass");
  });

  it("logs a transport error without credentials and rethrows it", async () => {
    withSettings();
    sendMail.mockRejectedValueOnce(new Error("boom"));

    await expect(makeService().send(notification)).rejects.toThrow("boom");

    expect(logger.error).toHaveBeenCalledWith(
      "[smtp] Failed to send email: boom"
    );
  });

  it("keeps at most four transports and closes the one it drops", async () => {
    const service = makeService();

    for (const host of ["a.test", "b.test", "c.test", "d.test", "e.test"]) {
      withSettings({ host });
      await service.send(notification);
    }

    expect(createTransport).toHaveBeenCalledTimes(5);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
