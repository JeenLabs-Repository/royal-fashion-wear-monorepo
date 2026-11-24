import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  toVendorLocationView,
  vendorLocationSerializer,
} from "../../../../lib/serializers/vendor/location";
import { requireVendor } from "../../../../lib/vendor/vendor-context";
import { getVendorModule } from "../../../../lib/vendor/vendor-module";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const locations = await getVendorModule(req.scope).listVendorLocations(
    { vendor_id: vendor.id },
    { take: null, order: { code: "ASC" } }
  );

  res.json({
    locations: vendorLocationSerializer.serializeMany(
      locations.map((location) => toVendorLocationView(location))
    ),
  });
}
