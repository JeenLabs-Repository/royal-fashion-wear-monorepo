import type { MiddlewareRoute } from "@medusajs/framework/http";
import { inventoryMiddlewares } from "./inventory";
import { productsMiddlewares } from "./products";
import { reviewsMiddlewares } from "./reviews";
import { storeMiddlewares } from "./store";
import { uploadsMiddlewares } from "./uploads";

// One array for src/api/middlewares.ts. Each area owns its own file, so two
// areas never edit the same file.
export const catalogMiddlewares: MiddlewareRoute[] = [
  ...uploadsMiddlewares,
  ...productsMiddlewares,
  ...inventoryMiddlewares,
  ...reviewsMiddlewares,
  ...storeMiddlewares,
];
