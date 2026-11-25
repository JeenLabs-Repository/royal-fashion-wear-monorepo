// The only place payment code reaches the staff alert and audit helpers. Each
// helper is loaded when it is called, so the adapter works whether or not the
// helper exists yet: a missing helper logs a tagged line instead, and adopting
// a helper later needs no edit here. Neither function ever rejects.

type PaymentContainer = { resolve: (key: string) => unknown };

type LoggerLike = {
  info?: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PaymentAuditAction = "payment.reconciliation_run" | "refund.issued";

export type NotifyStaffInput = {
  /** Short name of the alert, used in the log tag */
  kind: string;
  roleKeys: readonly string[];
  subject: string;
  heading: string;
  lines: string[];
  link?: { label: string; url: string };
  /** `<kind>:<entity-id>:<bucket>` */
  idempotencyKey: string;
};

export type AuditPaymentInput = {
  action: PaymentAuditAction;
  target?: { type: string; id?: string | null };
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  actor?: {
    id?: string | null;
    type: "user" | "vendor" | "customer" | "system";
    label?: string | null;
    roles?: readonly string[];
  };
};

const SYSTEM_ACTOR = {
  id: "system",
  type: "system",
  label: "payments",
  roles: [],
} as const;

type AlertHelper = {
  sendStaffAlert: (options: Record<string, unknown>) => Promise<boolean>;
};
type AuditHelper = {
  recordAuditSafe: (
    container: PaymentContainer,
    input: Record<string, unknown>
  ) => Promise<boolean>;
};

// Optional shared helpers, loaded at call time so payment code works before or
// after the alert and audit modules land.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- optional shared helper, loaded at call time
const requireAlerts = (): AlertHelper => require("../alerts/send-staff-alert");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- optional shared helper, loaded at call time
const requireAudit = (): AuditHelper => require("../audit/record-audit");

const isMissingModule = (error: unknown, needle: string): boolean => {
  const failure = error as { code?: string; message?: string } | null;
  return (
    failure?.code === "MODULE_NOT_FOUND" &&
    String(failure.message).includes(needle)
  );
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getLogger = (container: PaymentContainer): LoggerLike => {
  try {
    return container.resolve("logger") as LoggerLike;
  } catch {
    return { info: console.info, warn: console.warn, error: console.error };
  }
};

function loadHelper<T>(
  load: () => T,
  needle: string,
  tag: string,
  logger: LoggerLike
): T | null {
  try {
    return load();
  } catch (error) {
    if (!isMissingModule(error, needle)) {
      logger.error(
        `[${tag}] shared helper failed to load: ${message(error)}`
      );
    }
    return null;
  }
}

/** Which shared helpers the adapter can load right now. Used by the detector test. */
export function helperAvailability(): { alerts: boolean; audit: boolean } {
  const quiet: LoggerLike = { warn: () => undefined, error: () => undefined };
  return {
    alerts:
      loadHelper(requireAlerts, "send-staff-alert", "staff-alert", quiet) !==
      null,
    audit: loadHelper(requireAudit, "record-audit", "audit", quiet) !== null,
  };
}

export async function notifyStaff(
  container: PaymentContainer,
  input: NotifyStaffInput
): Promise<boolean> {
  const tag = `staff-alert:${input.kind}`;
  const logger = getLogger(container);
  try {
    if (input.idempotencyKey.split(":").length < 3) {
      logger.warn(
        `[${tag}] idempotency key "${input.idempotencyKey}" is not <kind>:<id>:<bucket>`
      );
    }
    const helper = loadHelper(requireAlerts, "send-staff-alert", tag, logger);
    if (!helper) {
      logger.warn(
        `[${tag}] ${input.subject} | ${input.heading} (shared alert helper not installed, nothing sent)`
      );
      return false;
    }
    return await helper.sendStaffAlert({
      container,
      kind: input.kind,
      roleKeys: input.roleKeys,
      props: {
        subject: input.subject,
        heading: input.heading,
        lines: input.lines,
        ...(input.link ? { link: input.link } : {}),
      },
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    logger.error(`[${tag}] failed: ${message(error)}`);
    return false;
  }
}

export async function auditPayment(
  container: PaymentContainer,
  input: AuditPaymentInput
): Promise<boolean> {
  const logger = getLogger(container);
  try {
    const helper = loadHelper(requireAudit, "record-audit", "audit", logger);
    if (!helper) {
      logger.info?.(
        `[audit] ${JSON.stringify({ action: input.action, target: input.target ?? null })}`
      );
      return false;
    }
    return await helper.recordAuditSafe(container, {
      action: input.action,
      actor: input.actor ?? SYSTEM_ACTOR,
      target: input.target,
      before: input.before,
      after: input.after,
      meta: input.meta,
    });
  } catch (error) {
    logger.error(`[audit] failed for ${input.action}: ${message(error)}`);
    return false;
  }
}
