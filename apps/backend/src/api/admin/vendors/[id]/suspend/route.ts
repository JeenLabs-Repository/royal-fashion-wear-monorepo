import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { toAdminVendorView } from "../../../../../lib/serializers/admin/vendor";
import { adminVendorBody, staffActor } from "../../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../../lib/vendor/eligibility";
import { suspendVendorWorkflow } from "../../../../../workflows/vendors/suspend-vendor";
import { ReasonBody } from "../../validators";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = adminVendorBody(ReasonBody, req);

  await suspendVendorWorkflow(req.scope).run({
    input: { vendor_id: req.params.id, reason: body.reason, actor: staffActor(req) },
  });

  const vendor = await loadVendor(req.scope, req.params.id);
  res.json({ vendor: await toAdminVendorView(req.scope, vendor) });
}
