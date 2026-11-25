import { matrixCatalog } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

// The update body is vendor A's own draft content with a new title. Vendor B sending it for
// A's product id gets the same 404 as for a missing id, because ownership is checked first.
const entries: MatrixEntry[] = [
  {
    method: "GET",
    path: "/vendor/products/:id",
    idParams: { id: () => matrixCatalog.detailProductId },
  },
  {
    method: "POST",
    path: "/vendor/products/:id",
    idParams: { id: () => matrixCatalog.updateProductId },
    body: () => matrixCatalog.updateBody,
  },
];

export default entries;
