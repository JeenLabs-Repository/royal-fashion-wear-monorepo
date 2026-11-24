// The only Medusa middleware file in this project. Medusa documents no order
// between two matching middleware entries, so a second file or a second entry
// for /admin could run before the admin chain. Later work adds its own
// matcher arrays by importing them from src/lib/* and spreading them here;
// request bodies are validated inside route handlers, which keeps the admin
// chain first.

import { defineMiddlewares } from "@medusajs/framework/http";
import { adminMiddlewareRoutes } from "../lib/rbac/admin-chain";

export default defineMiddlewares({
  routes: [...adminMiddlewareRoutes],
});
