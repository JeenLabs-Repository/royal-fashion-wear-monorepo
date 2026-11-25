export type ApiIssue = { path: string; message: string }

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly issues: ApiIssue[]

  constructor(status: number, code: string | null, message: string, issues: ApiIssue[] = []) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.issues = issues
  }
}

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error
  }
  if (error instanceof Error && error.message) {
    return new ApiError(0, null, error.message)
  }
  return new ApiError(0, null, "Something went wrong. Try again.")
}

export const errorText = (error: unknown): string => toApiError(error).message
