import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { invalidInviteError } from "../../../lib/vendor/errors";
import { hashInviteToken } from "../../../lib/vendor/invite-token";
import { VENDOR_MODULE } from "../../../modules/vendor";
import type VendorModuleService from "../../../modules/vendor/service";

const MAX_TOKEN_LENGTH = 200;

// The single atomic update inside consumeInviteToken is the whole check. The
// compensation puts the token back, so a failure later in the workflow leaves
// the invitation usable.
export const consumeInviteTokenStep = createStep(
  "consume-invite-token",
  async (input: { token: string }, { container }) => {
    if (
      typeof input.token !== "string" ||
      input.token.length === 0 ||
      input.token.length > MAX_TOKEN_LENGTH
    ) {
      throw invalidInviteError();
    }
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const consumed = await vendor.consumeInviteToken(hashInviteToken(input.token));
    if (!consumed) {
      throw invalidInviteError();
    }
    return new StepResponse(
      { invite_id: consumed.id, vendor_user_id: consumed.vendor_user_id },
      { invite_id: consumed.id }
    );
  },
  async (data, { container }) => {
    if (!data) {
      return;
    }
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    await vendor.releaseInviteToken(data.invite_id);
  }
);

// Loads the person the token belongs to. A vendor that is no longer in the
// invited state (for example suspended) gets the same generic refusal.
export const loadInvitedVendorStep = createStep(
  "load-invited-vendor",
  async (input: { vendor_user_id: string }, { container }) => {
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const [user] = await vendor.listVendorUsers({ id: input.vendor_user_id }, { take: 1 });
    if (!user) {
      throw invalidInviteError();
    }
    const [record] = await vendor.listVendors({ id: user.vendor_id }, { take: 1 });
    if (!record || record.status !== "invited") {
      throw invalidInviteError();
    }
    return new StepResponse({
      vendor_user_id: user.id,
      vendor_id: record.id,
      email: user.email,
    });
  }
);
