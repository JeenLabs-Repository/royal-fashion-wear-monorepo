import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { adminVendorLocationSerializer } from "../../../../../lib/serializers/admin/vendor";
import { toVendorLocationView } from "../../../../../lib/serializers/vendor/location";
import { adminVendorBody, staffActor } from "../../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../../lib/vendor/eligibility";
import { getVendorModule } from "../../../../../lib/vendor/vendor-module";
import { createVendorLocationWorkflow } from "../../../../../workflows/vendors/create-vendor-location";
import { CreateLocationBody } from "../../validators";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = adminVendorBody(CreateLocationBody, req);
  const vendor = await loadVendor(req.scope, req.params.id);

  const { result } = await createVendorLocationWorkflow(req.scope).run({
    input: { vendor_id: vendor.id, ...body, actor: staffActor(req) },
  });

  const [location] = await getVendorModule(req.scope).listVendorLocations(
    { id: result.id, vendor_id: vendor.id },
    { take: 1 }
  );
  res.json({ location: adminVendorLocationSerializer.serialize(toVendorLocationView(location)) });
}
