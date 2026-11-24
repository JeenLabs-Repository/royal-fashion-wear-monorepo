import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { findIdentityIdsByEmail } from "../../../lib/vendor/auth-identities";
import { invalidInviteError } from "../../../lib/vendor/errors";

// Any identity on this address, of any actor type, ends the attempt with the
// generic refusal. The log line carries no address.
export const assertNoExistingIdentityStep = createStep(
  "assert-no-existing-identity",
  async (input: { email: string }, { container }) => {
    const ids = await findIdentityIdsByEmail(container, input.email);
    if (ids.length > 0) {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
        warn: (m: string) => void;
      };
      logger.warn("[vendor-invite] refused: identity already exists");
      throw invalidInviteError();
    }
    return new StepResponse({ checked: true });
  }
);
