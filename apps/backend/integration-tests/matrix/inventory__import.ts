import { matrixStock } from "../support/stock-fixtures";
import type { MatrixEntry } from "./types";

// A one-row file for vendor A's own SKU and location. There is no id in the path: the vendor
// comes from the session, and another vendor sending this file gets row errors, not data.
const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/inventory/import",
    multipart: async () => ({
      field: "file",
      filename: "stock.csv",
      contentType: "text/csv",
      bytes: Buffer.from(
        `vendor_sku,location_code,stocked_quantity\n${matrixStock.sku},${matrixStock.locationCode},2\n`
      ),
    }),
  },
];

export default entries;
