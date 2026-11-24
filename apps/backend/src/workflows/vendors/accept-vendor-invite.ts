import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { invalidPasswordError } from "../../lib/vendor/errors";
import { assertNoExistingIdentityStep } from "./steps/assert-no-existing-identity";
import { consumeInviteTokenStep, loadInvitedVendorStep } from "./steps/consume-invite-token";
import { createVendorIdentityStep, linkVendorActorStep } from "./steps/create-vendor-identity";

export type AcceptVendorInviteInput = {
  token: string;
  password: string;
};

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// Runs before anything is consumed, so a short or long password leaves the
// invitation unused. There are no composition rules, only the length.
const validatePasswordStep = createStep(
  "validate-password",
  async (input: { password: string }) => {
    const length = typeof input.password === "string" ? Array.from(input.password).length : 0;
    if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      throw invalidPasswordError();
    }
    return new StepResponse({ valid: true });
  }
);

// The only path that creates a vendor identity. Input is a token and a
// password; the address comes from the person the token belongs to.
export const acceptVendorInviteWorkflow = createWorkflow(
  "accept-vendor-invite",
  function (input: AcceptVendorInviteInput) {
    validatePasswordStep({ password: input.password });

    const consumed = consumeInviteTokenStep({ token: input.token });
    const invited = loadInvitedVendorStep({ vendor_user_id: consumed.vendor_user_id });

    assertNoExistingIdentityStep({ email: invited.email });

    const identity = createVendorIdentityStep({
      email: invited.email,
      password: input.password,
    });

    linkVendorActorStep({
      auth_identity_id: identity.auth_identity_id,
      vendor_user_id: invited.vendor_user_id,
    });

    const result = transform({ invited }, (data) => ({
      vendor_user_id: data.invited.vendor_user_id,
    }));
    return new WorkflowResponse(result);
  }
);
