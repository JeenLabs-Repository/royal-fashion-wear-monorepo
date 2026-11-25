import { Button, Heading, Input, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { StateChip } from "../components/products/StateChip"
import { StatusBanner } from "../components/StatusBanner"
import { useProducts } from "../lib/api/products"
import { errorText } from "../lib/errors"
import { useSession } from "../lib/session"

const PAGE_SIZE = 20

const STATE_FILTERS = [
  { value: "", label: "All states" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "In review" },
  { value: "approved", label: "Live" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
]

const formatDate = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export const ProductsList = () => {
  const navigate = useNavigate()
  const { me } = useSession()
  const [state, setState] = useState("")
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)

  // The search text is sent 300 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [text])

  const products = useProducts({
    state: state || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const canCreate = me?.vendor.eligible_to_list !== false
  const data = products.data
  const filtered = Boolean(state || q)
  const total = data?.count ?? 0
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  const create = () => navigate("/products/new")

  return (
    <div className="flex min-w-0 flex-col gap-y-4" data-testid="screen-products">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level="h1">Products</Heading>
        <Button onClick={create} disabled={!canCreate}>
          Create product
        </Button>
      </div>

      {!canCreate && (
        <StatusBanner tone="warning">
          Your account is not active yet. You can create products when the store team activates it.
        </StatusBanner>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-y-1">
          <label htmlFor="products-search" className="txt-small-plus">
            Search products
          </label>
          <Input
            id="products-search"
            type="search"
            value={text}
            placeholder="Search by title"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-y-1">
          <label htmlFor="products-state" className="txt-small-plus">
            State
          </label>
          <select
            id="products-state"
            value={state}
            onChange={(event) => {
              setState(event.target.value)
              setPage(0)
            }}
            className="h-8 rounded-md border border-ui-border-base bg-ui-bg-field px-2 txt-small"
          >
            {STATE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {products.isLoading && (
        <div className="flex flex-col gap-y-2" role="status" aria-label="Loading products">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-10 animate-pulse rounded-md bg-ui-bg-component" />
          ))}
        </div>
      )}

      {products.isError && (
        <div className="flex flex-col items-start gap-y-2" role="alert">
          <Text className="text-ui-fg-error">{errorText(products.error)}</Text>
          <Button size="small" variant="secondary" onClick={() => void products.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && total === 0 && !filtered && (
        <div className="flex flex-col items-start gap-y-3 rounded-md bg-ui-bg-base p-4 shadow-elevation-card-rest" data-testid="products-empty">
          <Text>
            You have no products yet. A product starts as a draft. You send it for review and the store team decides before it goes on sale.
          </Text>
          <Button onClick={create} disabled={!canCreate}>
            Create product
          </Button>
        </div>
      )}

      {data && total === 0 && filtered && (
        <Text className="text-ui-fg-subtle" data-testid="products-no-match">
          No products match this search.
        </Text>
      )}

      {data && data.products.length > 0 && (
        <>
          <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-md bg-ui-bg-base shadow-elevation-card-rest">
            <table className="w-full min-w-[32rem] text-left txt-small" data-testid="products-table">
              <thead className="border-b border-ui-border-base text-ui-fg-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-2">
                    State
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Variants
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Last updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => (
                  <tr key={product.id} className="border-b border-ui-border-base last:border-0">
                    <td className="px-3 py-2">
                      <Link to={`/products/${product.id}`} className="text-ui-fg-interactive txt-small-plus">
                        {product.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StateChip state={product.state} is_live={product.is_live} has_pending={product.has_pending} />
                    </td>
                    <td className="px-3 py-2">{product.variant_count}</td>
                    <td className="px-3 py-2">{formatDate(product.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text size="small" className="text-ui-fg-subtle">
              Showing {from} to {to} of {total}
            </Text>
            <div className="flex gap-2">
              <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="small" variant="secondary" disabled={to >= total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
