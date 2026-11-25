// The only Medusa middleware file in this project. Medusa documents no order
// between two matching middleware entries, so a second file or a second entry
// for /admin could run before the admin chain. Later work adds its own
// matcher arrays by importing them from src/lib/* and spreading them here;
// request bodies are validated inside route handlers, which keeps the admin
// chain first.

import {
  authenticate,
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
  type MiddlewareRoute,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { storeGuardRoutes } from "../lib/anonymity/store-guard";
import { catalogMiddlewares } from "../lib/catalog/middlewares";
import { validateAddressInput } from "../lib/geo-india/address-validation";
import { portalRouteEntries } from "../lib/portal/serve-portal";
import { adminMiddlewareRoutes } from "../lib/rbac/admin-chain";
import { vendorRouteEntries } from "../lib/vendor/middlewares";

type BodyRecord = Record<string, unknown>;

const isBodyRecord = (value: unknown): value is BodyRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkAddress(address: BodyRecord): BodyRecord {
  const result = validateAddressInput(address);
  if (!result.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      result.message,
      result.code
    );
  }
  return result.address;
}

// nested: names of the address objects inside the body (cart routes).
// null: the body itself is the address (customer address routes).
function applyAddressRules(body: unknown, nested: readonly string[] | null) {
  if (!isBodyRecord(body)) {
    return;
  }
  if (nested === null) {
    Object.assign(body, checkAddress(body));
    return;
  }
  for (const key of nested) {
    const value = body[key];
    if (isBodyRecord(value)) {
      body[key] = checkAddress(value);
    }
  }
}

// Core attaches its own body validator to these routes. Depending on which runs
// first, the handler reads either the raw body or the validated copy, so the
// rules are applied to both and the normalised values land in whichever is read.
function addressValidator(nested: readonly string[] | null) {
  return (
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      applyAddressRules(req.body, nested);
      applyAddressRules(
        (req as MedusaRequest & { validatedBody?: unknown }).validatedBody,
        nested
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

const CART_ADDRESS_KEYS = ["shipping_address", "billing_address"] as const;

export const addressValidationRoutes: MiddlewareRoute[] = [
  {
    matcher: "/store/carts/:id",
    method: ["POST"],
    middlewares: [addressValidator(CART_ADDRESS_KEYS)],
  },
  {
    matcher: "/store/customers/me/addresses",
    method: ["POST"],
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      addressValidator(null),
    ],
  },
  {
    matcher: "/store/customers/me/addresses/:address_id",
    method: ["POST"],
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      addressValidator(null),
    ],
  },
];

export default defineMiddlewares({
  routes: [
    ...adminMiddlewareRoutes,
    ...storeGuardRoutes,
    ...vendorRouteEntries,
    ...portalRouteEntries,
    // Catalog entries come last so authentication, the two-factor gate and the vendor status guard run first.
    ...catalogMiddlewares,
    ...addressValidationRoutes,
  ],
});
