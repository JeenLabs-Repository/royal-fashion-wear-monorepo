import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { parseStrict } from "../../../lib/vendor/strict-query";
import { acceptVendorInviteWorkflow } from "../../../workflows/vendors/accept-vendor-invite";
import { AcceptInviteSchema, type AcceptInviteBody } from "../validators";

// The only vendor route that needs no sign-in. Everything it can refuse comes
// back as the same generic message from the workflow.
export async function POST(req: MedusaRequest<AcceptInviteBody>, res: MedusaResponse) {
  const body = parseStrict(AcceptInviteSchema, req.body);
  await acceptVendorInviteWorkflow(req.scope).run({ input: body });
  res.json({ ok: true });
}
