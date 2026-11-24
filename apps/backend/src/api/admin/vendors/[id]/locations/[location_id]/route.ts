import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { adminVendorLocationSerializer } from "../../../../../../lib/serializers/admin/vendor";
import { toVendorLocationView } from "../../../../../../lib/serializers/vendor/location";
import { adminVendorBody, staffActor } from "../../../../../../lib/vendor/admin-middlewares";
import { getVendorModule } from "../../../../../../lib/vendor/vendor-module";
import { updateVendorLocationWorkflow } from "../../../../../../workflows/vendors/update-vendor-location";
import { UpdateLocationBody } from "../../../validators";

// Both ids go to the workflow, which treats a location of another vendor as not
// found.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const patch = adminVendorBody(UpdateLocationBody, req);

  await updateVendorLocationWorkflow(req.scope).run({
    input: {
      vendor_id: req.params.id,
      location_id: req.params.location_id,
      patch,
      actor: staffActor(req),
    },
  });

  const [location] = await getVendorModule(req.scope).listVendorLocations(
    { id: req.params.location_id, vendor_id: req.params.id },
    { take: 1 }
  );
  if (!location) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  res.json({ location: adminVendorLocationSerializer.serialize(toVendorLocationView(location)) });
}
