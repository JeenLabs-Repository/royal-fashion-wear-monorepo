import { createHash } from "node:crypto";
import { AbstractNotificationProviderService } from "@medusajs/framework/utils";
import type { Logger, NotificationTypes } from "@medusajs/framework/types";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getSmtpSettings } from "../../../lib/settings/smtp";
import type { SmtpSettings } from "../../../lib/settings/smtp";
import type { OptionsContainer } from "../../../lib/settings/resolve-options";

// What Medusa hands a notification provider is the module's dependency cradle.
// Settings are read through getSmtpSettings on every send; the cradle must
// resolve the logger and (when present) the Integration Module.
type InjectedDependencies = {
  logger: Logger;
} & Record<string, unknown>;

// Transports are kept per set of connection settings so a settings change
// builds a new one on the next send, with no restart. The map is small on
// purpose: a store has one mail setup, and a few entries cover a change.
const MAX_CACHED_TRANSPORTS = 4;
const transports = new Map<string, Transporter>();

/** Empties the transport cache. Used by tests only. */
export function resetSmtpTransportCacheForTests(): void {
  transports.clear();
}

function transportFor(settings: SmtpSettings): Transporter {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        settings.host,
        settings.port,
        settings.secure,
        settings.user,
        settings.pass,
      ])
    )
    .digest("hex");

  const cached = transports.get(key);
  if (cached) {
    return cached;
  }

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth:
      settings.user && settings.pass
        ? { user: settings.user, pass: settings.pass }
        : undefined,
  });

  if (transports.size >= MAX_CACHED_TRANSPORTS) {
    const oldest = transports.keys().next().value;
    if (oldest !== undefined) {
      transports.get(oldest)?.close();
      transports.delete(oldest);
    }
  }
  transports.set(key, transporter);
  return transporter;
}

function toOptionsContainer(
  dependencies: InjectedDependencies
): OptionsContainer {
  // Never read `.resolve` on an Awilix cradle: that name is looked up as a
  // registration and throws. Always wrap property access instead.
  return { resolve: (key: string) => dependencies[key] };
}

/**
 * Builds the `From` header. The store name goes in as the display name, so
 * the inbox shows the store rather than the bare address, and the subject line
 * no longer has to carry it.
 *
 * `nodemailer` takes the name and the address separately and encodes the name
 * itself, which is what makes a non-ASCII store name arrive intact. A `from`
 * that already spells out its own display name is left alone.
 */
function buildFrom(
  settings: Pick<SmtpSettings, "from" | "user" | "from_name">
): string | { name: string; address: string } | undefined {
  const address = settings.from || settings.user;

  if (!address) {
    return undefined;
  }

  const name = settings.from_name.trim();

  if (!name || address.includes("<")) {
    return address;
  }

  return { name, address };
}

export class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "smtp";

  private container_: InjectedDependencies;
  private logger: Logger;

  // Medusa still passes the registration options as a second argument. They
  // carry only the channel list now, and no setting is read here: the settings
  // are read on every send.
  constructor(
    container: InjectedDependencies,
    _options?: Record<string, unknown>
  ) {
    super();
    this.container_ = container;
    this.logger = container.logger;
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const content = notification.content as
      | { subject?: string; html?: string; text?: string }
      | undefined;

    if (!content) {
      this.logger.warn("[smtp] No content in notification, skipping");
      return {};
    }

    const { settings } = await getSmtpSettings(
      toOptionsContainer(this.container_)
    );

    if (!settings.host) {
      this.logger.warn("[smtp] not configured, skipping email");
      return {};
    }

    const mailOptions = {
      from: buildFrom(settings),
      replyTo: settings.reply_to || undefined,
      to: notification.to,
      subject: content.subject ?? "(no subject)",
      html: content.html,
      text: content.text,
    };

    try {
      const info = await transportFor(settings).sendMail(mailOptions);
      this.logger.info(`[smtp] Email sent: ${info.messageId}`);
      return { id: info.messageId };
    } catch (err: unknown) {
      // The message only: nodemailer errors can carry connection details, and
      // the settings are never logged.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[smtp] Failed to send email: ${message}`);
      throw err;
    }
  }
}
