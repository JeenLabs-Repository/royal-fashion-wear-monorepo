import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import multer from "multer";

// Exactly one file in the field named "file", at most 8 MiB, no other field.
// The file stays in memory: it is re-encoded and stored right away.
const parseOneFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
}).single("file");

const UNEXPECTED_FIELD_CODES = new Set([
  "LIMIT_UNEXPECTED_FILE",
  "LIMIT_FILE_COUNT",
  "LIMIT_FIELD_COUNT",
  "LIMIT_FIELD_KEY",
  "LIMIT_FIELD_VALUE",
  "LIMIT_PART_COUNT",
]);

const refuse = (res: MedusaResponse, code: string, message: string): void => {
  res.status(400).json({ type: "invalid_data", code, message });
};

/**
 * Reads the multipart body. It runs after the vendor request chain, so a
 * request that is not signed in never reaches it and its body is never read.
 * As a second line of defence it refuses to read anything when no vendor was
 * attached to the request.
 */
export function parseUploadBody(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  if (!(req as { vendor?: unknown }).vendor) {
    res.status(401).json({ type: "unauthorized", message: "Unauthorized" });
    return;
  }
  if (!/^multipart\/form-data/i.test(String(req.headers["content-type"] ?? ""))) {
    refuse(res, "file_required", "Send the image as multipart form data in the field named file.");
    return;
  }
  parseOneFile(req as never, res as never, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        refuse(res, "file_too_large", "The image is larger than 8 MB.");
        return;
      }
      if (UNEXPECTED_FIELD_CODES.has(error.code)) {
        refuse(
          res,
          "unexpected_field",
          "Send exactly one file in the field named file and nothing else."
        );
        return;
      }
    }
    next(error);
  });
}

export const uploadsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/vendor/uploads",
    // Default parser skips multipart; keep the stream for multer.
    bodyParser: false,
    middlewares: [parseUploadBody],
  },
];
