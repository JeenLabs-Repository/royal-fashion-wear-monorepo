import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { parseStrict } from "../../../../lib/vendor/strict-query";
import { requireVendor } from "../../../../lib/vendor/vendor-context";
import { ChangePasswordSchema } from "../../validators";

// Changes the signed-in vendor user's password after checking the current one.
// Call shapes match the staff password helper and the actor-mechanics record.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const auth = req.scope.resolve(Modules.AUTH);
  const { current_password, new_password } = parseStrict(ChangePasswordSchema, req.body);

  const check = await auth.authenticate("emailpass", {
    body: { email: vendor.user_email, password: current_password },
    url: "",
    headers: {},
    query: {},
    protocol: "",
  } as never);
  if (!check.success) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "The current password is not correct."
    );
  }

  const updated = await auth.updateProvider("emailpass", {
    email: vendor.user_email,
    password: new_password,
    entity_id: vendor.user_email,
  });
  if (!updated.success) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      updated.error ?? "The password could not be changed."
    );
  }

  res.json({ ok: true });
}
