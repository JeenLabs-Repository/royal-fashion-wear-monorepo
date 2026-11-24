import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getVendorOnboardingSettings } from "../../../lib/settings/vendor-onboarding";
import { toAdminVendorListItems } from "../../../lib/serializers/admin/vendor";
import { adminVendorQuery } from "../../../lib/vendor/admin-middlewares";
import { getVendorModule } from "../../../lib/vendor/vendor-module";
import { ListVendorsQuerySchema } from "./validators";

// Percent and underscore are wildcards in a LIKE pattern, so the search text
// escapes them and finds them as ordinary characters.
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = adminVendorQuery(ListVendorsQuerySchema, req);

  const filters: Record<string, unknown> = {};
  if (query.status) {
    filters.status = query.status;
  }
  if (query.q) {
    filters.internal_name = { $ilike: `%${escapeLike(query.q)}%` };
  }

  const [vendors, count] = await getVendorModule(req.scope).listAndCountVendors(filters, {
    skip: query.offset,
    take: query.limit,
    order: { created_at: "DESC" },
  });
  const items = await toAdminVendorListItems(req.scope, vendors);

  const settings = await getVendorOnboardingSettings(req.scope);
  const warnings = settings.current_agreement_version === "v1-draft" ? ["agreement_is_draft"] : [];

  res.json({ vendors: items, count, limit: query.limit, offset: query.offset, warnings });
}
