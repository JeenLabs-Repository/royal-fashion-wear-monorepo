import { Badge, Button, Input, Text } from "@medusajs/ui"
import { useState } from "react"
import { errorText, toApiError } from "../../lib/errors"
import {
  type InventoryList,
  type InventoryVariant,
  MAX_QUANTITY,
  useSaveStock,
} from "../../lib/api/inventory"

type Drafts = Record<string, Record<string, string>>
type RowErrors = Record<string, { row?: string; cells: Record<string, string> }>

const DIGITS = /^\d{0,7}$/

const currentValue = (variant: InventoryVariant, code: string): string =>
  String(variant.levels.find((level) => level.location_code === code)?.stocked_quantity ?? 0)

export const StockTable = ({ data }: { data: InventoryList }) => {
  const save = useSaveStock()
  const [drafts, setDrafts] = useState<Drafts>({})
  const [errors, setErrors] = useState<RowErrors>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const changedCodes = (variant: InventoryVariant): string[] =>
    data.locations
      .map((location) => location.code)
      .filter((code) => {
        const draft = drafts[variant.variant_id]?.[code]
        return draft !== undefined && draft !== currentValue(variant, code)
      })

  const edit = (variantId: string, code: string, value: string) => {
    if (!DIGITS.test(value)) return
    setDrafts((previous) => ({ ...previous, [variantId]: { ...previous[variantId], [code]: value } }))
    setErrors((previous) => {
      const { [variantId]: _removed, ...rest } = previous
      return rest
    })
  }

  const revert = (variantId: string) => {
    setDrafts((previous) => {
      const { [variantId]: _removed, ...rest } = previous
      return rest
    })
    setErrors((previous) => {
      const { [variantId]: _removed, ...rest } = previous
      return rest
    })
  }

  const saveRow = async (variant: InventoryVariant) => {
    const codes = changedCodes(variant)
    const cells: Record<string, string> = {}
    for (const code of codes) {
      const raw = drafts[variant.variant_id][code]
      if (raw === "" || Number(raw) > MAX_QUANTITY) {
        cells[code] = "Enter a whole number from 0 to 1,000,000."
      }
    }
    if (Object.keys(cells).length > 0) {
      setErrors((previous) => ({ ...previous, [variant.variant_id]: { cells } }))
      return
    }

    setSavingId(variant.variant_id)
    try {
      await save.mutateAsync(
        codes.map((code) => ({
          variant_id: variant.variant_id,
          location_code: code,
          stocked_quantity: Number(drafts[variant.variant_id][code]),
        }))
      )
      revert(variant.variant_id)
    } catch (error) {
      const failure = toApiError(error)
      const next: { row?: string; cells: Record<string, string> } = { cells: {} }
      if (failure.code === "stock_rejected") {
        for (const code of codes) {
          const level = variant.levels.find((entry) => entry.location_code === code)
          const reserved = level?.reserved_quantity ?? 0
          if (Number(drafts[variant.variant_id][code]) < reserved) {
            next.cells[code] = `At least ${reserved} are reserved for orders.`
          }
        }
        if (Object.keys(next.cells).length === 0) next.row = errorText(error)
      } else if (failure.status === 404) {
        next.row = "We could not find that item. Reload the page and try again."
      } else {
        next.row = errorText(error)
      }
      setErrors((previous) => ({ ...previous, [variant.variant_id]: next }))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-y-2">
      <Text size="small" className="text-ui-fg-subtle">
        {`Low means fewer than ${data.low_stock_threshold} units are available after the units reserved for orders.`}
      </Text>
      <div
        className="overflow-x-auto rounded-lg border border-ui-border-base"
        data-testid="stock-scroll"
      >
        <table className="w-full min-w-[640px] text-left" data-testid="stock-table">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th scope="col" className="txt-small-plus px-3 py-2">
                Product
              </th>
              <th scope="col" className="txt-small-plus px-3 py-2">
                SKU
              </th>
              {data.locations.map((location) => (
                <th
                  key={location.code}
                  scope="col"
                  className="txt-small-plus px-3 py-2"
                  data-location-code={location.code}
                >
                  {`${location.label} (${location.code})`}
                </th>
              ))}
              <th scope="col" className="txt-small-plus px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.variants.map((variant) => {
              const changed = changedCodes(variant)
              const rowError = errors[variant.variant_id]
              const busy = savingId === variant.variant_id
              return (
                <tr
                  key={variant.variant_id}
                  className="border-t border-ui-border-base align-top"
                  data-testid="stock-row"
                  data-sku={variant.vendor_sku}
                >
                  <td className="px-3 py-2">
                    <Text size="small" weight="plus">
                      {variant.product_title}
                    </Text>
                    {variant.variant_title && (
                      <Text size="small" className="text-ui-fg-subtle">
                        {variant.variant_title}
                      </Text>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Text size="small">{variant.vendor_sku}</Text>
                  </td>
                  {data.locations.map((location) => {
                    const level = variant.levels.find((entry) => entry.location_code === location.code)
                    const value =
                      drafts[variant.variant_id]?.[location.code] ??
                      currentValue(variant, location.code)
                    const cellError = rowError?.cells[location.code]
                    return (
                      <td key={location.code} className="px-3 py-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={value}
                          aria-label={`Stock for ${variant.vendor_sku} at ${location.code}`}
                          aria-invalid={cellError ? true : undefined}
                          data-location-code={location.code}
                          onChange={(event) =>
                            edit(variant.variant_id, location.code, event.target.value)
                          }
                          className="w-24"
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-x-2">
                          <Text size="xsmall" className="text-ui-fg-muted">
                            {`Reserved ${level?.reserved_quantity ?? 0}`}
                          </Text>
                          {level?.low_stock && (
                            <span data-testid="stock-low">
                              <Badge size="2xsmall" color="orange">
                                Low
                              </Badge>
                            </span>
                          )}
                        </div>
                        {cellError && (
                          <Text
                            size="xsmall"
                            className="mt-1 text-ui-fg-error"
                            role="alert"
                            data-testid="stock-error"
                          >
                            {cellError}
                          </Text>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2">
                    {changed.length > 0 && (
                      <div className="flex flex-col gap-y-2">
                        <span
                          className="txt-small-plus text-ui-fg-subtle"
                          data-testid="stock-unsaved"
                        >
                          Unsaved changes
                        </span>
                        <div className="flex gap-x-2">
                          <Button
                            size="small"
                            onClick={() => saveRow(variant)}
                            isLoading={busy}
                            disabled={busy}
                          >
                            Save
                          </Button>
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => revert(variant.variant_id)}
                            disabled={busy}
                          >
                            Revert
                          </Button>
                        </div>
                      </div>
                    )}
                    {rowError?.row && (
                      <Text
                        size="xsmall"
                        className="mt-1 text-ui-fg-error"
                        role="alert"
                        data-testid="stock-row-error"
                      >
                        {rowError.row}
                      </Text>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
