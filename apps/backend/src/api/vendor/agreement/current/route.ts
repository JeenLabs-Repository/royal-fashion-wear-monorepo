import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { readAgreementDocuments } from "../../../../modules/vendor/agreements";
import { getVendorOnboardingSettings } from "../../../../lib/settings/vendor-onboarding";
import { vendorAgreementSerializer } from "../../../../lib/serializers/vendor/agreement";
import { requireVendor } from "../../../../lib/vendor/vendor-context";
import { getVendorModule } from "../../../../lib/vendor/vendor-module";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const vendorModule = getVendorModule(req.scope);
  const { current_agreement_version: version } = await getVendorOnboardingSettings(req.scope);

  const users = await vendorModule.listVendorUsers(
    { vendor_id: vendor.id },
    { select: ["id"], take: null }
  );
  const [acceptance] = users.length
    ? await vendorModule.listVendorAgreementAcceptances(
        { vendor_user_id: users.map((user) => user.id), version },
        { take: 1, order: { accepted_at: "ASC" } }
      )
    : [];

  res.json(
    vendorAgreementSerializer.serialize({
      version,
      accepted: Boolean(acceptance),
      accepted_at: acceptance?.accepted_at ?? null,
      documents: readAgreementDocuments(version),
    })
  );
}
