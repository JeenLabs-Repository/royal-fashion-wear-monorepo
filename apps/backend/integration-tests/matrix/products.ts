import { matrixCatalog, validContent } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

// The create body uses an upload that belongs to vendor A, so vendor B's copy of the same
// body is refused with the unknown-upload answer and never affects vendor A.
const entries: MatrixEntry[] = [
  { method: "GET", path: "/vendor/products" },
  {
    method: "POST",
    path: "/vendor/products",
    body: () =>
      validContent({
        uploadIds: [matrixCatalog.createUploadId],
        categoryId: matrixCatalog.categoryId,
        suffix: "matrix-create",
      }),
  },
];

export default entries;
