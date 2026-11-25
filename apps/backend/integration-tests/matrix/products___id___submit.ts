import { matrixCatalog } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/products/:id/submit",
    idParams: { id: () => matrixCatalog.submitProductId },
  },
];

export default entries;
