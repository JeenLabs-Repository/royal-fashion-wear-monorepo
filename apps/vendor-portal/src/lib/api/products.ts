import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchJson } from "../api"

export type SubmissionState = "draft" | "submitted" | "approved" | "changes_requested" | "rejected" | "withdrawn"

export type ProductListItem = {
  id: string
  title: string
  state: SubmissionState
  is_live: boolean
  has_pending: boolean
  thumbnail: string | null
  variant_count: number
  updated_at: string
}

export type ProductList = { products: ProductListItem[]; count: number; limit: number; offset: number }

export type VariantContent = {
  variant_id?: string
  vendor_sku: string
  option_values: Record<string, string>
  payout_price: string
  mrp?: string | null
  net_quantity_value?: number | null
  net_quantity_unit?: string | null
  weight_g?: number | null
  length_mm?: number | null
  width_mm?: number | null
  height_mm?: number | null
}

export type DeclarationContent = {
  generic_name?: string | null
  country_of_origin?: string | null
  packed_by_name?: string | null
  packed_by_address?: string | null
}

export type ProductContent = {
  title: string
  description: string
  images: { upload_id: string; url?: string }[]
  options: { title: string; values: string[] }[]
  variants: VariantContent[]
  proposed_category_id?: string | null
  proposed_gst_class?: string | null
  proposed_hsn?: string | null
  declaration?: DeclarationContent | null
}

export type ProductBody = Omit<ProductContent, "images"> & { images: { upload_id: string }[] }

export type ProductDetail = {
  id: string
  state: SubmissionState
  is_live: boolean
  has_pending: boolean
  reason: string | null
  revision: number
  submitted_at: string | null
  content: ProductContent
}

export type ListParams = { state?: string; q?: string; limit: number; offset: number }

export const productKeys = {
  all: ["portal", "products"] as const,
  list: (params: ListParams) => ["portal", "products", "list", params] as const,
  detail: (id: string) => ["portal", "products", "detail", id] as const,
  categories: ["portal", "products", "categories"] as const,
}

const base = "/vendor/products"
const one = (id: string) => `${base}/${encodeURIComponent(id)}`

export const listProducts = (params: ListParams) => {
  const query = new URLSearchParams()
  if (params.state) query.set("state", params.state)
  if (params.q) query.set("q", params.q)
  query.set("limit", String(params.limit))
  query.set("offset", String(params.offset))
  return fetchJson<ProductList>(`${base}?${query.toString()}`)
}

export const getProduct = (id: string) => fetchJson<{ product: ProductDetail }>(one(id))

export const getCategories = () => fetchJson<{ categories: { id: string; name: string }[] }>("/vendor/categories")

export const useProducts = (params: ListParams) =>
  useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => listProducts(params),
    placeholderData: keepPreviousData,
    retry: false,
  })

// The detail is not refetched on focus: the form owns what the vendor typed,
// and a background refetch must not replace it.
export const useProduct = (id: string | undefined) =>
  useQuery({
    queryKey: productKeys.detail(id ?? "none"),
    queryFn: () => getProduct(id as string),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
    retry: false,
  })

export const useCategories = () =>
  useQuery({ queryKey: productKeys.categories, queryFn: getCategories, staleTime: 5 * 60 * 1000, retry: false })

const useInvalidate = () => {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: productKeys.all })
}

export const useSaveProduct = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: ProductBody }) =>
      fetchJson<{ product: ProductDetail }>(id ? one(id) : base, { method: "POST", body }),
    onSuccess: invalidate,
  })
}

const useAction = (suffix: "submit" | "withdraw" | "discard-changes") => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => fetchJson<unknown>(`${one(id)}/${suffix}`, { method: "POST", body: {} }),
    onSuccess: invalidate,
  })
}

export const useSubmitProduct = () => useAction("submit")
export const useWithdrawProduct = () => useAction("withdraw")
export const useDiscardPending = () => useAction("discard-changes")
