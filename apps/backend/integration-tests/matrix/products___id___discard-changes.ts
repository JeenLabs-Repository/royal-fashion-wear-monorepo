import { matrixCatalog } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/products/:id/discard-changes",
    idParams: { id: () => matrixCatalog.discardProductId },
  },
];

export default entries;
