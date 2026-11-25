import { toApiError } from "../errors"

// Validation issues from the strict schema arrive with dot paths such as
// `variants.0.vendor_sku`. This turns them into one message per path so each
// field can show its own error.

export type FieldErrors = {
  fields: Record<string, string>
  form: string | null
}

export const NO_ERRORS: FieldErrors = { fields: {}, form: null }

// Errors that name no path but belong to one field.
const CODE_PATHS: Record<string, string> = {
  unknown_category: "proposed_category_id",
  unknown_upload: "images",
  upload_already_used: "images",
}

export function issuesToFieldErrors(error: unknown): FieldErrors {
  const failure = toApiError(error)

  if (failure.issues.length > 0) {
    const fields: Record<string, string> = {}
    for (const issue of failure.issues) {
      const path = issue.path || "form"
      if (!(path in fields)) {
        fields[path] = issue.message
      }
    }
    const { form, ...rest } = fields
    return {
      fields: rest,
      form: form ?? "Some fields need your attention. Fix the marked fields and try again.",
    }
  }

  const mapped = failure.code ? CODE_PATHS[failure.code] : undefined
  if (mapped) {
    return { fields: { [mapped]: failure.message }, form: null }
  }
  return { fields: {}, form: failure.message }
}

/** The message for one dot path, or undefined. */
export const errorFor = (errors: FieldErrors, path: string): string | undefined => errors.fields[path]

/** Every message at or below a path, for a section that owns several fields. */
export const errorsUnder = (errors: FieldErrors, prefix: string): string[] =>
  Object.entries(errors.fields)
    .filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
    .map(([, message]) => message)
