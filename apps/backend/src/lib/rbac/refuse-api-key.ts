// Secret API keys are refused on every admin route. Nothing in this project
// calls the admin API with a key; staff use a signed-in session or a bearer
// token, so refusing keys everywhere removes a credential that cannot be tied
// to a person or to a role.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { rejectRequest, type AdminRequest } from "./reject";

// The actor type the authenticate step reports for a secret API key.
export const API_KEY_ACTOR_TYPE = "api-key";

export function refuseApiKeyActors(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const actorType = req.auth_context?.actor_type;

  if (actorType === API_KEY_ACTOR_TYPE) {
    rejectRequest(res, {
      status: 403,
      code: "api_key_not_allowed",
      message: "API keys cannot be used on admin routes. Sign in as a staff user.",
    });
    return;
  }
  if (actorType !== "user") {
    rejectRequest(res, {
      status: 403,
      code: "wrong_actor_type",
      message: "This sign-in cannot be used on admin routes.",
    });
    return;
  }
  next();
}
