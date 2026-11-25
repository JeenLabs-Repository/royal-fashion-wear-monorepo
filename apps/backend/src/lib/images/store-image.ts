import { randomUUID } from "node:crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Stores an already processed image through the file module under
 * `products/<uuid-v4>.webp`. The name holds nothing but a random id: no owner
 * id, no product id and no original file name. The provider may add its own
 * prefix or suffix. Returns the stored file id and its public URL.
 */
export async function storeProcessedImage(
  scope: MedusaContainer,
  data: Buffer
): Promise<{ id: string; url: string }> {
  // Providers decode content as binary text (buffer.toString("binary")), with a
  // base64 round-trip probe first. Binary matches the Medusa upload guide.
  const { result } = await uploadFilesWorkflow(scope).run({
    input: {
      files: [
        {
          filename: `products/${randomUUID()}.webp`,
          mimeType: "image/webp",
          content: data.toString("binary"),
          access: "public",
        },
      ],
    },
  });
  const file = result[0];
  if (!file) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The file module returned no stored file."
    );
  }
  return { id: file.id, url: file.url };
}
