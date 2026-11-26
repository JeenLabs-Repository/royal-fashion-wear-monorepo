const mockWorkflowRun = jest.fn();
const mockReadCredentials = jest.fn();

jest.mock(
  "@jeenlabs-repository/medusa-payment-razorpay/public",
  () => ({
    RAZORPAY_EVENTS: { reconciliationCompleted: "razorpay.reconciliation.completed" },
    readRazorpayCredentials: (...args: unknown[]) => mockReadCredentials(...args),
    reconcileRazorpayPaymentsWorkflow: () => ({
      run: (...args: unknown[]) => mockWorkflowRun(...args),
    }),
  }),
  { virtual: true }
);
jest.mock("../staff-hooks", () => ({
  notifyStaff: jest.fn(async () => true),
  auditPayment: jest.fn(async () => true),
}));

import razorpayReconciliationJob, {
  config as jobConfig,
  runReconciliationJob,
} from "../../../jobs/razorpay-reconciliation";
import razorpayReconciliationCompletedHandler, {
  config as completedConfig,
  handleReconciliationCompleted,
} from "../../../subscribers/razorpay-reconciliation-completed";
import { auditPayment, notifyStaff } from "../staff-hooks";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const container = {
  resolve: (key: string) => (key === "logger" ? logger : undefined),
} as never;

const completed = (overrides: Record<string, unknown> = {}) => ({
  run_id: "rzrr_01",
  mismatch_count: 0,
  scanned_count: 12,
  truncated: false,
  date_ist: "2026-03-05",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReadCredentials.mockResolvedValue({ credentials: { key_id: "rzp_test_x" } });
  mockWorkflowRun.mockResolvedValue({ result: { run_id: "rzrr_01" } });
});

describe("daily reconciliation job", () => {
  it("is named and scheduled for 02:30 in India (21:00 UTC)", () => {
    expect(jobConfig.name).toBe("razorpay-reconciliation");
    expect(jobConfig.schedule).toBe("0 21 * * *");
  });

  it("runs the workflow once when the card is configured", async () => {
    await runReconciliationJob(container);
    expect(mockWorkflowRun).toHaveBeenCalledTimes(1);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("skips with one log line when the card is not configured", async () => {
    mockReadCredentials.mockResolvedValue({ reason: "unsaved" });
    await runReconciliationJob(container);
    expect(mockWorkflowRun).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs and returns when the card cannot be read", async () => {
    mockReadCredentials.mockRejectedValue(new Error("settings unavailable"));
    await expect(runReconciliationJob(container)).resolves.toBeUndefined();
    expect(mockWorkflowRun).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("alerts once with the error text only when the workflow fails", async () => {
    mockWorkflowRun.mockRejectedValue(new Error("gateway timed out"));
    await runReconciliationJob(container, new Date("2026-03-04T21:00:00Z"));
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.kind).toBe("payment-reconciliation");
    expect(input.roleKeys).toEqual(["superadmin", "finance_readonly"]);
    expect(input.lines[0]).toBe("Reason: gateway timed out");
    // 21:00 UTC is already the next calendar day in India.
    expect(input.idempotencyKey).toBe("recon:2026-03-05:failed");
  });

  it("does not throw when the failure alert itself fails", async () => {
    mockWorkflowRun.mockRejectedValue(new Error("boom"));
    (notifyStaff as jest.Mock).mockRejectedValueOnce(new Error("mail down"));
    await expect(runReconciliationJob(container)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("runs through the default export", async () => {
    await razorpayReconciliationJob(container as never);
    expect(mockWorkflowRun).toHaveBeenCalledTimes(1);
  });
});

describe("reconciliation completion subscriber", () => {
  it("listens for the completion event", () => {
    expect(completedConfig.event).toBe("razorpay.reconciliation.completed");
  });

  it("audits a clean run and sends no alert", async () => {
    await handleReconciliationCompleted(container, completed());
    expect(auditPayment).toHaveBeenCalledTimes(1);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("audits with the run id as target and counts only as meta", async () => {
    await handleReconciliationCompleted(container, completed({ mismatch_count: 2 }));
    const input = (auditPayment as jest.Mock).mock.calls[0][1];
    expect(input.action).toBe("payment.reconciliation_run");
    expect(input.target).toEqual({ type: "reconciliation_run", id: "rzrr_01" });
    expect(Object.keys(input.meta).sort()).toEqual([
      "date_ist",
      "mismatch_count",
      "scanned_count",
      "truncated",
    ]);
  });

  it("alerts the right roles once per day when there are mismatches", async () => {
    await handleReconciliationCompleted(container, completed({ mismatch_count: 3 }));
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.roleKeys).toEqual(["superadmin", "finance_readonly"]);
    expect(input.idempotencyKey).toBe("recon:2026-03-05:daily");
    expect(input.subject).toBe("Payment reconciliation: 3 mismatches found");
  });

  it("uses the singular for one mismatch", async () => {
    await handleReconciliationCompleted(container, completed({ mismatch_count: 1 }));
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.subject).toBe("Payment reconciliation: 1 mismatch found");
  });

  it("alerts on a truncated run even with no mismatches", async () => {
    await handleReconciliationCompleted(container, completed({ truncated: true }));
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.subject).toBe("Payment reconciliation was cut short");
    expect(input.lines.join(" ")).toContain("cut short");
  });

  it("mentions truncation in the lines of a mismatch alert", async () => {
    await handleReconciliationCompleted(
      container,
      completed({ mismatch_count: 2, truncated: true })
    );
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.lines.join(" ")).toContain("2,000");
  });

  it("ignores an unexpected payload with one warning", async () => {
    await handleReconciliationCompleted(container, { run_id: 5 });
    expect(auditPayment).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("still alerts when the audit entry fails", async () => {
    (auditPayment as jest.Mock).mockRejectedValueOnce(new Error("audit down"));
    await handleReconciliationCompleted(container, completed({ mismatch_count: 1 }));
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the alert fails", async () => {
    (notifyStaff as jest.Mock).mockRejectedValueOnce(new Error("mail down"));
    await expect(
      handleReconciliationCompleted(container, completed({ mismatch_count: 1 }))
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("reads the payload from the event", async () => {
    await razorpayReconciliationCompletedHandler({
      event: { name: "razorpay.reconciliation.completed", data: completed({ mismatch_count: 1 }) },
      container,
    } as never);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("keeps customer data out of the alert lines", async () => {
    await handleReconciliationCompleted(
      container,
      completed({ mismatch_count: 1, email: "buyer@example.test", phone: "9876543210" })
    );
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(JSON.stringify(input)).not.toContain("buyer@example.test");
    expect(JSON.stringify(input)).not.toContain("9876543210");
  });
});
