import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { buildIdempotencyKey, sendTemplatedEmail } from "../../../emails/lib/send-email";
import { safeHttpUrl } from "../../../emails/lib/safe-url";
import { buildAcceptUrl, generateInviteToken } from "../../../lib/vendor/invite-token";
import { getVendorOnboardingSettings } from "../../../lib/settings/vendor-onboarding";
import { VENDOR_MODULE } from "../../../modules/vendor";
import type VendorModuleService from "../../../modules/vendor/service";

export type CreateInviteInput = {
  vendor_id: string;
  user_id: string;
  email: string;
  contact_name: string;
  include_accept_url?: boolean;
};

export type CreateInviteOutput = {
  invite_id: string;
  expires_at: string;
  email_sent: boolean;
  accept_url?: string;
};

const portalBaseUrl = (): string =>
  process.env.VENDOR_PORTAL_URL?.trim() ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173/vendor-portal");

const storeName = (): string => process.env.STORE_NAME?.trim() || "the store";

// "Friday 27 November 2026, 18:30 IST", written out so the wording does not
// depend on the ICU build of the server.
export function formatIstLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")} ${pick("day")} ${pick("month")} ${pick("year")}, ${pick("hour")}:${pick("minute")} IST`;
}

// One step does everything that touches the raw token, so the token never
// reaches another step, a workflow result or the log. It is returned only
// inside accept_url, and only when include_accept_url is true (tests and seed code).
export const createInviteAndSendEmailStep = createStep(
  "create-vendor-invite-and-send-email",
  async (input: CreateInviteInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
      info: (m: string) => void;
      error: (m: string) => void;
    };
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;

    const settings = await getVendorOnboardingSettings(container);
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + settings.invite_expiry_hours * 60 * 60 * 1000);

    const invite = await vendor.createVendorInvites({
      vendor_user_id: input.user_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const baseUrl = portalBaseUrl();
    const acceptUrl = safeHttpUrl(baseUrl) ? buildAcceptUrl(baseUrl, token) : undefined;

    let emailSent = false;
    if (!acceptUrl) {
      logger.error("[vendor-invite] VENDOR_PORTAL_URL is not an http or https address, email not sent");
    } else {
      try {
        emailSent = await sendTemplatedEmail({
          container,
          template: "vendor-invite",
          to: input.email,
          props: {
            store_name: storeName(),
            contact_name: input.contact_name,
            accept_url: acceptUrl,
            expires_label: formatIstLabel(expiresAt),
            expiry_hours: settings.invite_expiry_hours,
          },
          idempotencyKey: buildIdempotencyKey("vendor-invite", invite.id, "send"),
          tag: "vendor-invite",
        });
      } catch (error) {
        logger.error(
          `[vendor-invite] sending failed for invite ${invite.id}: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    logger.info(
      `[vendor-invite] invite ${invite.id} created for vendor ${input.vendor_id}, email sent: ${emailSent}`
    );

    const output: CreateInviteOutput = {
      invite_id: invite.id,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
    };
    if (input.include_accept_url && acceptUrl) {
      output.accept_url = acceptUrl;
    }
    return new StepResponse(output, { invite_id: invite.id });
  },
  async (data, { container }) => {
    if (!data) {
      return;
    }
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    await vendor.deleteVendorInvites([data.invite_id]);
  }
);
