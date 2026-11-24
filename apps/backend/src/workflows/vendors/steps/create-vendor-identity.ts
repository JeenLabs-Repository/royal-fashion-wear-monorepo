import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  deleteAuthIdentity,
  linkVendorActor,
  registerEmailpassIdentity,
} from "../../../lib/vendor/auth-identities";
import { invalidInviteError } from "../../../lib/vendor/errors";

export const createVendorIdentityStep = createStep(
  "create-vendor-identity",
  async (input: { email: string; password: string }, { container }) => {
    let authIdentityId: string;
    try {
      authIdentityId = await registerEmailpassIdentity(container, input.email, input.password);
    } catch (error) {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
        warn: (m: string) => void;
      };
      logger.warn(
        `[vendor-invite] identity creation failed: ${error instanceof MedusaError ? error.message : "unexpected error"}`
      );
      throw invalidInviteError();
    }
    return new StepResponse({ auth_identity_id: authIdentityId }, { auth_identity_id: authIdentityId });
  },
  async (data, { container }) => {
    if (!data) {
      return;
    }
    await deleteAuthIdentity(container, data.auth_identity_id);
  }
);

// A failure here rolls back to the previous step, which deletes the identity.
export const linkVendorActorStep = createStep(
  "link-vendor-actor",
  async (input: { auth_identity_id: string; vendor_user_id: string }, { container }) => {
    await linkVendorActor(container, input.auth_identity_id, input.vendor_user_id);
    return new StepResponse({ linked: true });
  }
);
