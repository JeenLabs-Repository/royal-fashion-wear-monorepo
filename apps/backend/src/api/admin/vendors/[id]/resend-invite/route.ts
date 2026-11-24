import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { toAdminVendorListItem } from "../../../../../lib/serializers/admin/vendor";
import { adminVendorBody, staffActor } from "../../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../../lib/vendor/eligibility";
import { resendVendorInviteWorkflow } from "../../../../../workflows/vendors/resend-vendor-invite";
import { EmptyBodySchema } from "../../validators";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  adminVendorBody(EmptyBodySchema, req);

  const { result } = await resendVendorInviteWorkflow(req.scope).run({
    input: { vendor_id: req.params.id, actor: staffActor(req) },
  });

  const vendor = await loadVendor(req.scope, req.params.id);
  res.json({
    vendor: await toAdminVendorListItem(req.scope, vendor),
    invite: { expires_at: result.expires_at, email_sent: result.email_sent },
  });
}
