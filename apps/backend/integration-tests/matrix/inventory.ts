import { matrixStock } from "../support/stock-fixtures";
import type { MatrixEntry } from "./types";

// The ids travel in the body and the query, not in the path: another vendor sending vendor A's
// variant and location gets the same 404 as for ids that do not exist.
const entries: MatrixEntry[] = [
  { method: "GET", path: "/vendor/inventory" },
  {
    method: "PUT",
    path: "/vendor/inventory",
    body: () => ({
      updates: [
        {
          variant_id: matrixStock.variantId,
          location_code: matrixStock.locationCode,
          stocked_quantity: 3,
        },
      ],
    }),
  },
];

export default entries;
