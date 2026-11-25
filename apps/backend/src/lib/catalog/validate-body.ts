import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type { z } from "@medusajs/framework/zod";

export type ValidationIssue = { path: string; message: string };

/**
 * One issue per failure, with a dot-joined path such as `variants.0.vendor_sku`.
 * An unknown key reports the key itself as the path, for example `status`.
 */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const issue of error.issues) {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      for (const key of (issue as { keys: string[] }).keys) {
        issues.push({ path: [...base, key].join("."), message: `${key} is not allowed.` });
      }
    } else {
      issues.push({ path: base.join("."), message: issue.message });
    }
  }
  return issues;
}

/**
 * Route middleware. On failure it answers 400 with the structured body and
 * does not call next. On success `req.validatedBody` holds the parsed value
 * (tags stripped, amounts normalised).
 */
export function validateCatalogBody(schema: z.ZodType<unknown>) {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        type: "invalid_data",
        code: "validation_failed",
        message: "The request has invalid fields.",
        issues: toValidationIssues(parsed.error),
      });
      return;
    }
    (req as unknown as { validatedBody: unknown }).validatedBody = parsed.data;
    next();
  };
}
