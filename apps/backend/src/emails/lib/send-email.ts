import { createHash } from "node:crypto";
import type { MedusaContainer } from "@medusajs/framework";
import type {
  INotificationModuleService,
  Logger,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import { render } from "@react-email/render";
import { createElement, type ComponentType } from "react";
import {
  EMAIL_TEMPLATES,
  type EmailTemplates,
  type TemplateEntry,
} from "./templates";

/**
 * Sends one typed email template to one or more addresses through the
 * Notification module. Never throws: a failure is logged and reported as
 * `false`, so one failed mail never fails the work that asked for it.
 */

const MAX_SUBJECT_LENGTH = 150;

export type SendTemplatedEmailOptions<K extends keyof EmailTemplates> = {
  container: MedusaContainer;
  template: K;
  to: string | string[];
  /** Typed per template; a field the template does not declare is a compile error */
  props: EmailTemplates[K];
  /** `<kind>:<entity-id>:<bucket>`, makes repeated sends a no-op */
  idempotencyKey: string;
  /** Prefixes every log line, for example `staff-alert:vendor-signup` */
  tag?: string;
};

/** Joins the three parts of an idempotency key. Rejects empty parts and colons. */
export function buildIdempotencyKey(
  kind: string,
  entityId: string,
  bucket: string
): string {
  for (const [name, part] of [
    ["kind", kind],
    ["entityId", entityId],
    ["bucket", bucket],
  ] as const) {
    if (!part || part.includes(":")) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Idempotency key part "${name}" must be non-empty and must not contain a colon`
      );
    }
  }
  return `${kind}:${entityId}:${bucket}`;
}

const cleanSubject = (subject: string): string =>
  subject.replace(/[\r\n]/g, "").slice(0, MAX_SUBJECT_LENGTH);

// A recipient's own suffix keeps one delivery from suppressing another's.
const keyForRecipient = (key: string, address: string): string =>
  `${key}:${createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 10)}`;

export async function sendTemplatedEmail<K extends keyof EmailTemplates>({
  container,
  template,
  to,
  props,
  idempotencyKey,
  tag = "send-email",
}: SendTemplatedEmailOptions<K>): Promise<boolean> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;

  try {
    const recipients = (Array.isArray(to) ? to : [to])
      .map((address) => address.trim())
      .filter(Boolean);

    if (!recipients.length) {
      logger.warn(`[${tag}] No recipients for ${template}, skipping`);
      return false;
    }

    const parts = idempotencyKey.split(":");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      logger.warn(
        `[${tag}] Idempotency key "${idempotencyKey}" is not <kind>:<entity-id>:<bucket>`
      );
    }

    const entry = EMAIL_TEMPLATES[template] as unknown as TemplateEntry<
      EmailTemplates[K]
    >;
    const html = await render(
      createElement(
        entry.Component as unknown as ComponentType<EmailTemplates[K] & object>,
        props as EmailTemplates[K] & object
      )
    );
    const subject = cleanSubject(entry.subject(props));
    const text = entry.text(props);

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService;

    let allSent = true;
    for (const address of recipients) {
      try {
        await notificationService.createNotifications({
          to: address,
          channel: "email",
          template,
          trigger_type: template,
          resource_type: "staff-email",
          idempotency_key: Array.isArray(to)
            ? keyForRecipient(idempotencyKey, address)
            : idempotencyKey,
          content: { subject, html, text },
        } as Parameters<INotificationModuleService["createNotifications"]>[0]);
        logger.info(`[${tag}] Sent ${template} to ${address}`);
      } catch (error) {
        allSent = false;
        logger.error(
          `[${tag}] failed to send ${template}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return allSent;
  } catch (error) {
    logger.error(
      `[${tag}] failed to send ${template}: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
