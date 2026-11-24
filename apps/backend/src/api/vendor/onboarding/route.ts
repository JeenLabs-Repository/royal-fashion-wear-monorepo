import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { vendorOnboardingSerializer } from "../../../lib/serializers/vendor/onboarding";
import { getOnboardingSteps } from "../../../lib/vendor/onboarding-steps";
import { requireVendor } from "../../../lib/vendor/vendor-context";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const vendorModule = getVendorModule(req.scope);

  const steps = await getOnboardingSteps(req.scope, { id: vendor.id, status: vendor.status });

  const users = await vendorModule.listVendorUsers(
    { vendor_id: vendor.id },
    { select: ["id"], take: null }
  );
  const invites = users.length
    ? await vendorModule.listVendorInvites(
        { vendor_user_id: users.map((user) => user.id) },
        { take: null }
      )
    : [];
  const registered = invites.some((invite) => Boolean(invite.used_at));
  const requiredDone = steps
    .filter((step) => step.required_for_activation)
    .every((step) => step.complete);

  res.json(
    vendorOnboardingSerializer.serialize({
      status: vendor.status,
      activation_pending: vendor.status === "invited" && registered && requiredDone,
      steps,
    })
  );
}
