import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { logWith } from "./vendor-module";

// The stock register route would create a sign-in identity without a token.
// Every identity for a vendor is created by the accept workflow instead, so the
// route answers as if it did not exist. No body is read or logged.
export function blockVendorRegistration(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  logWith(req.scope, "info", "[auth] vendor registration route blocked");
  next(new MedusaError(MedusaError.Types.NOT_FOUND, "Not found"));
}
