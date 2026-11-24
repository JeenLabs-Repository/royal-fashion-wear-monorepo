import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { isMfaEnrolled } from "../../../lib/mfa";
import { vendorSelfSerializer, vendorUserSerializer } from "../../../lib/serializers/vendor/self";
import { getVendorEligibility } from "../../../lib/vendor/eligibility";
import { requireVendor } from "../../../lib/vendor/vendor-context";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const context = requireVendor(req);
  const vendorModule = getVendorModule(req.scope);
  const [vendor] = await vendorModule.listVendors({ id: context.id }, { take: 1 });
  const [user] = await vendorModule.listVendorUsers({ id: context.user_id }, { take: 1 });
  const eligibility = await getVendorEligibility(req.scope, context.id);

  res.json({
    vendor: vendorSelfSerializer.serialize({
      ...vendor,
      eligible_to_list: eligibility.eligible,
    }),
    user: vendorUserSerializer.serialize(user),
    mfa_enabled: isMfaEnrolled(req.auth_context as never),
  });
}
