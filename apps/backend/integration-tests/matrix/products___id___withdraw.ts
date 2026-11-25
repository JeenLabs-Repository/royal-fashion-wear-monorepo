import { matrixCatalog } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/products/:id/withdraw",
    idParams: { id: () => matrixCatalog.withdrawProductId },
  },
];

export default entries;
