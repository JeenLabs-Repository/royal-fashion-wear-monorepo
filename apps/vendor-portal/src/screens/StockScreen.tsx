import { Button, Heading, Input, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { CsvImportPanel } from "../components/stock/CsvImportPanel"
import { StockTable } from "../components/stock/StockTable"
import { StatusBanner } from "../components/StatusBanner"
import { useInventory } from "../lib/api/inventory"
import { errorText } from "../lib/errors"
import { useSession } from "../lib/session"

const PAGE_SIZE = 50

export const StockScreen = () => {
  const { me } = useSession()
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

  const inventory = useInventory({ q: q || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const data = inventory.data
  const total = data?.count ?? 0
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)
  const notActive = me?.vendor.eligible_to_list === false

  return (
    <div className="flex min-w-0 flex-col gap-y-6" data-testid="screen-stock">
      <div className="flex flex-col gap-y-1">
        <Heading level="h1">Stock</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Set how many units you have at each location. Orders reserve units; you cannot go below
          the reserved number.
        </Text>
      </div>

      {notActive && (
        <StatusBanner tone="warning">
          Your account is not active yet. You can change stock when the store team activates it.
        </StatusBanner>
      )}

      <div className="flex flex-col gap-y-1 sm:max-w-sm">
        <label htmlFor="stock-search" className="txt-small-plus">
          Search products
        </label>
        <Input
          id="stock-search"
          type="search"
          value={text}
          placeholder="Search by title"
          data-testid="stock-search"
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {inventory.isError && (
        <StatusBanner tone="error">
          <span>{errorText(inventory.error)}</span>{" "}
          <Button size="small" variant="secondary" onClick={() => inventory.refetch()}>
            Try again
          </Button>
        </StatusBanner>
      )}

      {inventory.isPending && (
        <div role="status" aria-label="Loading stock">
          <Text className="text-ui-fg-subtle">Loading stock…</Text>
        </div>
      )}

      {data && data.count === 0 && !q && (
        <Text className="text-ui-fg-subtle" data-testid="stock-empty">
          No live products yet. Stock can be set once a product is approved.
        </Text>
      )}

      {data && data.count === 0 && q && (
        <Text className="text-ui-fg-subtle" data-testid="stock-no-match">
          No products match your search.
        </Text>
      )}

      {data && data.count > 0 && (
        <>
          <StockTable data={data} />
          <div className="flex items-center justify-between gap-x-3">
            <Text size="small" className="text-ui-fg-subtle">{`${from} to ${to} of ${total}`}</Text>
            <div className="flex gap-x-2">
              <Button
                size="small"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={to >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <CsvImportPanel />
    </div>
  )
}
