import { matrixCatalog } from "../support/catalog-fixtures";
import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "GET",
    path: "/vendor/products/:id",
    idParams: { id: () => matrixCatalog.detailProductId },
  },
];

export default entries;
