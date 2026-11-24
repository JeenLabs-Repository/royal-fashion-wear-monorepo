import type { MedusaContainer } from "@medusajs/framework";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { sendTemplatedEmail } from "../../emails/lib/send-email";
import type { EmailTemplates } from "../../emails/lib/templates";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access/constants";
import type StaffAccessModuleService from "../../modules/staff-access/service";

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Email addresses of the staff who hold any of the given roles right now.
 * The break-glass account is excluded (it is alerted through its own list),
 * addresses are checked for a plain shape and de-duplicated ignoring case.
 */
export async function resolveRoleRecipients(
  container: MedusaContainer,
  roleKeys: readonly string[]
): Promise<string[]> {
  const staffAccess = container.resolve(
    STAFF_ACCESS_MODULE
  ) as StaffAccessModuleService;
  const assignments = await staffAccess.listStaffAssignments(
    { role_key: [...roleKeys] },
    { select: ["user_id", "is_break_glass"], take: null }
  );

  const userIds = [
    ...new Set(
      assignments
        .filter((assignment) => !assignment.is_break_glass)
        .map((assignment) => assignment.user_id)
    ),
  ];
  if (!userIds.length) {
    return [];
  }

  const userService = container.resolve(Modules.USER) as {
    listUsers: (
      filters: Record<string, unknown>,
      config: Record<string, unknown>
    ) => Promise<{ id: string; email: string | null }[]>;
  };
  const users = await userService.listUsers(
    { id: userIds },
    { select: ["id", "email"], take: null }
  );

  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const user of users) {
    const email = user.email?.trim();
    if (!email || !EMAIL_PATTERN.test(email)) {
      continue;
    }
    const folded = email.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
      addresses.push(email);
    }
  }
  return addresses;
}

export type SendStaffAlertOptions = {
  container: MedusaContainer;
  /** Short name of the alert, used in the log tag */
  kind: string;
  roleKeys: readonly string[];
  props: EmailTemplates["staff-alert"];
  /** `<kind>:<entity-id>:<bucket>` */
  idempotencyKey: string;
};

/**
 * Emails every holder of the given roles. Recipients are looked up at send
 * time, so a role change takes effect on the next alert. Never throws.
 */
export async function sendStaffAlert({
  container,
  kind,
  roleKeys,
  props,
  idempotencyKey,
}: SendStaffAlertOptions): Promise<boolean> {
  const tag = `staff-alert:${kind}`;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;

  try {
    const to = await resolveRoleRecipients(container, roleKeys);
    if (!to.length) {
      logger.warn(
        `[${tag}] No recipients for roles ${roleKeys.join(", ")}, alert not sent`
      );
      return false;
    }
    return await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to,
      props,
      idempotencyKey,
      tag,
    });
  } catch (error) {
    logger.error(
      `[${tag}] failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
