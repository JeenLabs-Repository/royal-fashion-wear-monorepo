import type { MatrixMultipart } from "../matrix/types";

/**
 * Builds the form for a multipart matrix entry. Extra keys become text fields
 * sent before the file, so a stray key is met first and refused.
 */
export function toFormData(
  multipart: MatrixMultipart,
  extra: Record<string, unknown> = {}
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(extra)) {
    form.append(name, String(value));
  }
  form.append(
    multipart.field,
    new Blob([new Uint8Array(multipart.bytes)], { type: multipart.contentType }),
    multipart.filename
  );
  return form;
}
