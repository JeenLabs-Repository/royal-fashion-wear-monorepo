import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { adminVendorQuery } from "../../../../lib/vendor/admin-middlewares";
import { loadStateCoverage } from "../../../../lib/vendor/state-coverage";
import { EmptyQuerySchema } from "../validators";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  adminVendorQuery(EmptyQuerySchema, req);
  res.json({ states: await loadStateCoverage(req.scope) });
}
