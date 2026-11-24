import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { assertInvitableEmailStep } from "./steps/assert-invitable-email";
import { createInviteAndSendEmailStep } from "./steps/create-invite-and-send-email";
import { createVendorRecordsStep } from "./steps/create-vendor-records";

export type InviteVendorInput = {
  internal_name: string;
  contact_name: string;
  contact_email: string;
  note?: string;
  actor: { id: string; label?: string };
  /** Tests and seed code only: returns the link, which holds the raw token */
  include_accept_url?: boolean;
};

export const inviteVendorWorkflow = createWorkflow(
  "invite-vendor",
  function (input: InviteVendorInput) {
    const email = assertInvitableEmailStep({ contact_email: input.contact_email });

    const records = createVendorRecordsStep({
      internal_name: input.internal_name,
      contact_name: input.contact_name,
      contact_email: email,
      note: input.note,
    });

    const invite = createInviteAndSendEmailStep({
      vendor_id: records.vendor_id,
      user_id: records.user_id,
      email,
      contact_name: input.contact_name,
      include_accept_url: input.include_accept_url,
    });

    const auditInput = transform({ input, records, invite }, (data) => ({
      event: {
        action: "vendor.invited" as const,
        target_id: data.records.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        after: { status: "invited", invite_expires_at: data.invite.expires_at },
      },
    }));
    auditVendorEventStep(auditInput);

    // accept_url is present only when include_accept_url is true.
    const result = transform({ records, invite }, (data) => ({
      vendor_id: data.records.vendor_id,
      user_id: data.records.user_id,
      invite_id: data.invite.invite_id,
      expires_at: data.invite.expires_at,
      email_sent: data.invite.email_sent,
      accept_url: data.invite.accept_url,
    }));

    return new WorkflowResponse(result);
  }
);
