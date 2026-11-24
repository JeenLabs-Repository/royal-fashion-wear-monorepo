import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { rejectRequest } from "../../../../lib/rbac/reject";
import { parseStrict } from "../../../../lib/vendor/strict-query";
import { requireVendor } from "../../../../lib/vendor/vendor-context";
import { acceptVendorAgreementWorkflow } from "../../../../workflows/vendors/accept-vendor-agreement";
import { AcceptAgreementSchema } from "../../validators";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const body = parseStrict(AcceptAgreementSchema, req.body);
  const userAgent = req.headers["user-agent"];

  try {
    const { result } = await acceptVendorAgreementWorkflow(req.scope).run({
      input: {
        vendor_user_id: vendor.user_id,
        version: body.version,
        ip: req.ip ?? null,
        user_agent: typeof userAgent === "string" ? userAgent : null,
      },
    });

    res.json({ accepted: true, version: result.version, accepted_at: result.accepted_at });
  } catch (error) {
    // Medusa's CONFLICT handler replaces the custom code with invalid_state_error.
    // Re-emit agreement_version_changed the same way staff remaps last_superadmin.
    if (MedusaError.isMedusaError(error) && error.code === "agreement_version_changed") {
      rejectRequest(res, {
        status: 409,
        code: "agreement_version_changed",
        type: "conflict",
        message: error.message,
      });
      return;
    }
    throw error;
  }
}
