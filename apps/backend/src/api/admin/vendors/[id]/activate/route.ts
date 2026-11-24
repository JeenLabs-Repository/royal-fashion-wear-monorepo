import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { toAdminVendorView } from "../../../../../lib/serializers/admin/vendor";
import { adminVendorBody, staffActor } from "../../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../../lib/vendor/eligibility";
import { activateVendorWorkflow } from "../../../../../workflows/vendors/activate-vendor";
import { EmptyBodySchema } from "../../validators";

// A handler that blocks activation throws a MedusaError. Its message is not
// changed on the way out, so the owner reads the plugin's own words.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  adminVendorBody(EmptyBodySchema, req);

  await activateVendorWorkflow(req.scope).run({
    input: { vendor_id: req.params.id, actor: staffActor(req) },
  });

  const vendor = await loadVendor(req.scope, req.params.id);
  res.json({ vendor: await toAdminVendorView(req.scope, vendor) });
}
