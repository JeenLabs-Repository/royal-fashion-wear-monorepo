import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { findIdentityIdsByEmail } from "../../../lib/vendor/auth-identities";
import { VENDOR_MODULE } from "../../../modules/vendor";
import type VendorModuleService from "../../../modules/vendor/service";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// These messages are for staff, so they may be specific.
export const assertInvitableEmailStep = createStep(
  "assert-invitable-email",
  async (input: { contact_email: string }, { container }) => {
    const email = String(input.contact_email ?? "").trim().toLowerCase();
    if (!EMAIL_SHAPE.test(email)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Enter a valid email address.");
    }

    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const existingUsers = await vendor.listVendorUsers({ email }, { take: 1 });
    if (existingUsers.length > 0) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "A vendor with this contact email already exists."
      );
    }

    const identityIds = await findIdentityIdsByEmail(container, email);
    if (identityIds.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "This email address already has an account (customer, staff or vendor). Invite the vendor on a different address."
      );
    }

    return new StepResponse(email);
  }
);
