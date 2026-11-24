import { MedusaError } from "@medusajs/framework/utils";
import { recordAudit, recordAuditSafe, type RecordAuditInput } from "../index";

const makeContainer = (appendImpl?: (row: any) => Promise<unknown>) => {
  const stored: any[] = [];
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const auditLog = {
    append: jest.fn(
      appendImpl ??
        (async (row: any) => {
          stored.push(row);
          return { id: "aud_test", ...row };
        })
    ),
  };
  const container = {
    resolve: (key: string) => {
      if (key === "logger") return logger;
      if (key === "auditLog") return auditLog;
      throw new Error(`unexpected key ${key}`);
    },
  };
  return { container, logger, auditLog, stored };
};

const baseInput = (): RecordAuditInput => ({
  action: "integration.updated",
  actor: {
    id: "user_1",
    type: "user",
    label: "owner@example.test",
    roles: ["superadmin"],
  },
  target: { type: "integration", id: "int_1" },
  before: { enabled: false, api_key: "BEFORE-SECRET" },
  after: { enabled: true, api_key: "AFTER-SECRET" },
  http: {
    method: "POST",
    path: "/admin/integrations/int_1",
    route: "/admin/integrations/:id",
    status: 200,
  },
  ip: "203.0.113.9",
  forwardedFor: "203.0.113.9",
  userAgent: "jest",
  requestId: "req_1",
  meta: { change_id: "chg_1", token: "META-SECRET" },
});

describe("recordAudit", () => {
  test("stores a redacted row with every column mapped", async () => {
    const { container, stored } = makeContainer();
    await recordAudit(container, baseInput());
    const row = stored[0];
    expect(row.actor_id).toBe("user_1");
    expect(row.actor_type).toBe("user");
    expect(row.actor_label).toBe("owner@example.test");
    expect(row.roles).toEqual(["superadmin"]);
    expect(row.action).toBe("integration.updated");
    expect(row.target_type).toBe("integration");
    expect(row.target_id).toBe("int_1");
    expect(row.http_method).toBe("POST");
    expect(row.http_route).toBe("/admin/integrations/:id");
    expect(row.http_status).toBe(200);
    expect(row.ip).toBe("203.0.113.9");
    expect(row.request_id).toBe("req_1");
    const text = JSON.stringify(row);
    expect(text).not.toContain("BEFORE-SECRET");
    expect(text).not.toContain("AFTER-SECRET");
    expect(text).not.toContain("META-SECRET");
    expect(row.after.enabled).toBe(true);
  });

  test("logs exactly one [audit] line holding the stored row as JSON", async () => {
    const { container, logger } = makeContainer();
    await recordAudit(container, baseInput());
    const lines = logger.info.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((line: string) => line.startsWith("[audit] "));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].slice("[audit] ".length));
    expect(parsed.action).toBe("integration.updated");
    expect(lines[0]).not.toContain("AFTER-SECRET");
  });

  test("an unknown action throws outside production", async () => {
    const { container, auditLog } = makeContainer();
    const input = {
      ...baseInput(),
      action: "made.up",
    } as unknown as RecordAuditInput;
    await expect(recordAudit(container, input)).rejects.toBeInstanceOf(
      MedusaError
    );
    await expect(recordAudit(container, input)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    });
    expect(auditLog.append).not.toHaveBeenCalled();
  });

  test("an unknown action in production warns and still writes", async () => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const { container, logger, auditLog } = makeContainer();
      const input = {
        ...baseInput(),
        action: "made.up",
      } as unknown as RecordAuditInput;
      await recordAudit(container, input);
      expect(auditLog.append).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
  });

  test("a failing append rejects recordAudit and logs the failure", async () => {
    const { container, logger } = makeContainer(async () => {
      throw new Error("boom");
    });
    await expect(recordAudit(container, baseInput())).rejects.toThrow("boom");
    expect(logger.error).toHaveBeenCalledWith("[audit] write failed: boom");
  });

  test("a failing append makes recordAuditSafe resolve false", async () => {
    const { container, logger } = makeContainer(async () => {
      throw new Error("boom");
    });
    await expect(recordAuditSafe(container, baseInput())).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith("[audit] write failed: boom");
  });

  test("recordAuditSafe resolves true on success", async () => {
    const { container } = makeContainer();
    await expect(recordAuditSafe(container, baseInput())).resolves.toBe(true);
  });
});
