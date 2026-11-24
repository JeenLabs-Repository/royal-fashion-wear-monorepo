import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { createInviteAndSendEmailStep } from "./steps/create-invite-and-send-email";
import { assertResendableStep, expireEarlierInvitesStep } from "./steps/expire-earlier-invites";

export type ResendVendorInviteInput = {
  vendor_id: string;
  actor: { id: string; label?: string };
  include_accept_url?: boolean;
};

export const resendVendorInviteWorkflow = createWorkflow(
  "resend-vendor-invite",
  function (input: ResendVendorInviteInput) {
    const target = assertResendableStep({ vendor_id: input.vendor_id });

    expireEarlierInvitesStep({ user_id: target.user_id });

    const invite = createInviteAndSendEmailStep({
      vendor_id: target.vendor_id,
      user_id: target.user_id,
      email: target.email,
      contact_name: target.contact_name,
      include_accept_url: input.include_accept_url,
    });

    const auditInput = transform({ input, target, invite }, (data) => ({
      event: {
        action: "vendor.invited" as const,
        target_id: data.target.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        after: { status: "invited", invite_expires_at: data.invite.expires_at },
        meta: { resend: true },
      },
    }));
    auditVendorEventStep(auditInput);

    const result = transform({ target, invite }, (data) => ({
      vendor_id: data.target.vendor_id,
      user_id: data.target.user_id,
      invite_id: data.invite.invite_id,
      expires_at: data.invite.expires_at,
      email_sent: data.invite.email_sent,
      accept_url: data.invite.accept_url,
    }));

    return new WorkflowResponse(result);
  }
);
