import fs from "node:fs";
import path from "node:path";

type Hooks = typeof import("../staff-hooks");

const sendStaffAlert = jest.fn(async (_options: unknown) => true);
const recordAuditSafe = jest.fn(
  async (_container: unknown, _input: unknown) => true
);

const missing = (name: string) => () => {
  const error = new Error(`Cannot find module '${name}'`) as Error & {
    code: string;
  };
  error.code = "MODULE_NOT_FOUND";
  throw error;
};

async function loadWith(options: {
  alerts: "present" | "absent";
  audit: "present" | "absent";
}): Promise<Hooks> {
  jest.resetModules();
  jest.doMock(
    "../../alerts/send-staff-alert",
    options.alerts === "present"
      ? () => ({ sendStaffAlert })
      : missing("../alerts/send-staff-alert"),
    { virtual: true }
  );
  jest.doMock(
    "../../audit/record-audit",
    options.audit === "present"
      ? () => ({ recordAuditSafe })
      : missing("../audit/record-audit"),
    { virtual: true }
  );
  // require (not import) so Jest resolves the TypeScript source without a .js suffix
  // that tsc's node16 resolution would otherwise demand on a dynamic import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../staff-hooks") as Hooks;
}

const makeContainer = () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const container = {
    resolve: (key: string) => {
      if (key === "logger") return logger;
      throw new Error(`unexpected key ${key}`);
    },
  };
  return { container, logger };
};

const alertInput = {
  kind: "recon",
  roleKeys: ["superadmin", "finance_readonly"],
  subject: "Payment mismatches found",
  heading: "2 payments need attention",
  lines: ["captured_no_order: 1"],
  link: { label: "Open", url: "https://admin.example.test/reconciliation" },
  idempotencyKey: "recon:2026-01-02:daily",
};

beforeEach(() => {
  sendStaffAlert.mockReset();
  sendStaffAlert.mockResolvedValue(true);
  recordAuditSafe.mockReset();
  recordAuditSafe.mockResolvedValue(true);
});

describe("notifyStaff", () => {
  test("passes the template props, roles and key to the shared helper", async () => {
    const { notifyStaff } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    const { container } = makeContainer();
    await expect(notifyStaff(container, alertInput)).resolves.toBe(true);
    expect(sendStaffAlert).toHaveBeenCalledWith({
      container,
      kind: "recon",
      roleKeys: ["superadmin", "finance_readonly"],
      props: {
        subject: alertInput.subject,
        heading: alertInput.heading,
        lines: alertInput.lines,
        link: alertInput.link,
      },
      idempotencyKey: "recon:2026-01-02:daily",
    });
  });

  test("leaves the link out of the props when none is given", async () => {
    const { notifyStaff } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    const { container } = makeContainer();
    await notifyStaff(container, { ...alertInput, link: undefined });
    const call = sendStaffAlert.mock.calls[0][0] as {
      props: Record<string, unknown>;
    };
    expect("link" in call.props).toBe(false);
  });

  test("with the helper absent logs one tagged warning and returns false", async () => {
    const { notifyStaff } = await loadWith({
      alerts: "absent",
      audit: "absent",
    });
    const { container, logger } = makeContainer();
    await expect(notifyStaff(container, alertInput)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = logger.warn.mock.calls[0][0] as string;
    expect(line).toContain("[staff-alert:recon]");
    expect(line).toContain(alertInput.subject);
    expect(line).toContain(alertInput.heading);
  });

  test("a failing helper is logged and swallowed", async () => {
    const { notifyStaff } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    sendStaffAlert.mockRejectedValueOnce(new Error("smtp down"));
    const { container, logger } = makeContainer();
    await expect(notifyStaff(container, alertInput)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[staff-alert:recon] failed: smtp down")
    );
  });

  test("warns about a key that is not kind, id and bucket, and still sends", async () => {
    const { notifyStaff } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    const { container, logger } = makeContainer();
    await notifyStaff(container, { ...alertInput, idempotencyKey: "recon" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("is not <kind>:<id>:<bucket>")
    );
    expect(sendStaffAlert).toHaveBeenCalledTimes(1);
  });
});

describe("auditPayment", () => {
  test("calls the safe audit helper with the system actor by default", async () => {
    const { auditPayment } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    const { container } = makeContainer();
    await expect(
      auditPayment(container, {
        action: "payment.reconciliation_run",
        target: { type: "reconciliation_run", id: "rrun_1" },
        meta: { mismatch_count: 2 },
      })
    ).resolves.toBe(true);
    expect(recordAuditSafe).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        action: "payment.reconciliation_run",
        actor: { id: "system", type: "system", label: "payments", roles: [] },
        target: { type: "reconciliation_run", id: "rrun_1" },
        meta: { mismatch_count: 2 },
      })
    );
  });

  test("passes an explicit actor through", async () => {
    const { auditPayment } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    const { container } = makeContainer();
    const actor = {
      id: "user_1",
      type: "user" as const,
      label: "a@example.test",
      roles: ["finance_readonly"],
    };
    await auditPayment(container, { action: "refund.issued", actor });
    expect(recordAuditSafe.mock.calls[0][1]).toEqual(
      expect.objectContaining({ actor })
    );
  });

  test("with the helper absent logs one audit line with the action and target and returns false", async () => {
    const { auditPayment } = await loadWith({
      alerts: "absent",
      audit: "absent",
    });
    const { container, logger } = makeContainer();
    await expect(
      auditPayment(container, {
        action: "refund.issued",
        target: { type: "payment", id: "pay_1" },
      })
    ).resolves.toBe(false);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const line = logger.info.mock.calls[0][0] as string;
    expect(line.startsWith("[audit] ")).toBe(true);
    expect(JSON.parse(line.slice("[audit] ".length))).toEqual({
      action: "refund.issued",
      target: { type: "payment", id: "pay_1" },
    });
  });

  test("a failing audit helper is logged and swallowed", async () => {
    const { auditPayment } = await loadWith({
      alerts: "present",
      audit: "present",
    });
    recordAuditSafe.mockRejectedValueOnce(new Error("unknown audit action"));
    const { container, logger } = makeContainer();
    await expect(
      auditPayment(container, { action: "refund.issued" })
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("unknown audit action")
    );
  });
});

describe("helperAvailability", () => {
  test("reports what the adapter can load", async () => {
    const both = await loadWith({ alerts: "present", audit: "present" });
    expect(both.helperAvailability()).toEqual({ alerts: true, audit: true });
    const none = await loadWith({ alerts: "absent", audit: "absent" });
    expect(none.helperAvailability()).toEqual({ alerts: false, audit: false });
  });
});

describe("shared helper detector", () => {
  const srcRoot = path.resolve(__dirname, "../../..");

  test("a shared helper that exists on disk is loaded by the adapter", async () => {
    jest.resetModules();
    jest.dontMock("../../alerts/send-staff-alert");
    jest.dontMock("../../audit/record-audit");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { helperAvailability } = require("../staff-hooks") as Hooks;
    const available = helperAvailability();
    if (fs.existsSync(path.join(srcRoot, "lib/alerts/send-staff-alert.ts"))) {
      expect(available.alerts).toBe(true);
    }
    if (fs.existsSync(path.join(srcRoot, "lib/audit/record-audit.ts"))) {
      expect(available.audit).toBe(true);
    }
  });
});
