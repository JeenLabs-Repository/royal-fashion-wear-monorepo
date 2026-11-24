import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { VENDOR_MODULE } from "../../../modules/vendor";
import type VendorModuleService from "../../../modules/vendor/service";

export type ResendTarget = {
  vendor_id: string;
  user_id: string;
  email: string;
  contact_name: string;
};

// A resend is only for a vendor who has not registered yet.
export const assertResendableStep = createStep(
  "assert-resendable",
  async (input: { vendor_id: string }, { container }) => {
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const [record] = await vendor.listVendors({ id: input.vendor_id }, { take: 1 });
    if (!record) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor not found.");
    }
    const [user] = await vendor.listVendorUsers({ vendor_id: record.id }, { take: 1 });
    if (!user) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor user not found.");
    }
    const used = await vendor.listVendorInvites(
      { vendor_user_id: user.id, used_at: { $ne: null } } as never,
      { take: 1 }
    );
    if (record.status !== "invited" || used.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This vendor has already registered."
      );
    }
    const target: ResendTarget = {
      vendor_id: record.id,
      user_id: user.id,
      email: user.email,
      contact_name: user.name,
    };
    return new StepResponse(target);
  }
);

// An earlier link is retired by moving its expiry to the past, so `used_at`
// keeps meaning "this invitation registered the vendor".
export const expireEarlierInvitesStep = createStep(
  "expire-earlier-invites",
  async (input: { user_id: string }, { container }) => {
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const live = await vendor.listVendorInvites({
      vendor_user_id: input.user_id,
      used_at: null,
      expires_at: { $gt: new Date() },
    } as never);

    const retired = new Date(Date.now() - 1000);
    for (const invite of live) {
      await vendor.updateVendorInvites({ id: invite.id, expires_at: retired });
    }

    return new StepResponse(
      { count: live.length },
      live.map((invite) => ({ id: invite.id, expires_at: new Date(invite.expires_at).toISOString() }))
    );
  },
  async (previous, { container }) => {
    if (!previous?.length) {
      return;
    }
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    for (const invite of previous) {
      await vendor.updateVendorInvites({ id: invite.id, expires_at: new Date(invite.expires_at) });
    }
  }
);
