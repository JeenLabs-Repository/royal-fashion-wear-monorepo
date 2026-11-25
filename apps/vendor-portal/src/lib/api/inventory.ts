import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchJson, fetchText } from "../api"

export type InventoryLevel = {
  location_code: string
  stocked_quantity: number
  reserved_quantity: number
  low_stock: boolean
}

export type InventoryVariant = {
  variant_id: string
  product_title: string
  variant_title: string | null
  vendor_sku: string
  levels: InventoryLevel[]
}

export type InventoryLocation = { code: string; label: string }

export type InventoryList = {
  locations: InventoryLocation[]
  variants: InventoryVariant[]
  count: number
  limit: number
  offset: number
  low_stock_threshold: number
}

export type InventoryParams = { q?: string; limit?: number; offset?: number }

export type StockUpdate = { variant_id: string; location_code: string; stocked_quantity: number }

export type ImportRowError = {
  row: number
  code: string
  message?: string
  sku?: string
  location_code?: string
}

export type ImportResult = { applied: number; failed: number; errors: ImportRowError[] }

export const MAX_QUANTITY = 1_000_000
export const MAX_FILE_BYTES = 1_048_576

export const inventoryKeys = {
  all: ["vendor-inventory"] as const,
  list: (params: InventoryParams) => ["vendor-inventory", "list", params] as const,
}

// Plain words for each row code the import can report.
const ROW_MESSAGES: Record<string, string> = {
  unknown_sku: "This SKU is not one of your products.",
  unknown_location: "This location code is not one of yours.",
  not_approved: "This product is not live yet, so stock cannot be set.",
  invalid_quantity: "Quantity must be a whole number from 0 to 1,000,000.",
  below_reserved: "Quantity is below what is already reserved for orders.",
  duplicate_row: "This SKU and location appear earlier in the file. Only the first row counts.",
}

// Plain words for the problems that stop the whole file.
const FILE_MESSAGES: Record<string, string> = {
  invalid_header: "The first line must be exactly vendor_sku,location_code,stocked_quantity.",
  too_many_rows: "The file has more than 5,000 rows. Split it into smaller files.",
  file_too_large: "The file is larger than 1 MB. Split it into smaller files.",
  invalid_utf8: "The file is not UTF-8 text. Save it as CSV UTF-8 and try again.",
  invalid_csv: "The file is not valid CSV. Check for a quote that is never closed.",
  file_required: "Choose a CSV file first.",
}

export const FILE_TOO_LARGE_MESSAGE = FILE_MESSAGES.file_too_large

export const rowMessage = (code: string): string => ROW_MESSAGES[code] ?? "This row could not be applied."

export const fileMessage = (code: string | null): string | null =>
  code ? (FILE_MESSAGES[code] ?? null) : null

export const useInventory = (params: InventoryParams) =>
  useQuery({
    queryKey: inventoryKeys.list(params),
    queryFn: () => {
      const query = new URLSearchParams()
      query.set("limit", String(params.limit ?? 50))
      query.set("offset", String(params.offset ?? 0))
      if (params.q) query.set("q", params.q)
      return fetchJson<InventoryList>(`/vendor/inventory?${query.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

// The list is refetched after success and after a rejection, so the reserved
// numbers on screen are the ones the server used to decide.
export const useSaveStock = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (updates: StockUpdate[]) =>
      fetchJson<{ results: unknown }>("/vendor/inventory", { method: "PUT", body: { updates } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  })
}

export const importCsv = (file: File) => {
  const form = new FormData()
  form.append("file", file)
  return fetchJson<ImportResult>("/vendor/inventory/import", { method: "POST", form })
}

export const useImportCsv = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: importCsv,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  })
}

// Hands the text to the browser as a file download. The object URL is revoked
// right after the click.
const saveCsv = (text: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const downloadTemplate = async () =>
  saveCsv(await fetchText("/vendor/inventory/template"), "stock-template.csv")

export const downloadExport = async () =>
  saveCsv(await fetchText("/vendor/inventory/export"), "stock-export.csv")
