import { Button, Input } from "@medusajs/ui"

// One editable row per variant. Values are kept as the text the vendor typed
// and are converted when the form is sent.
export type VariantRow = {
  key: string
  variant_id?: string
  option_values: Record<string, string>
  vendor_sku: string
  payout_price: string
  mrp: string
  net_quantity_value: string
  net_quantity_unit: string
  weight_g: string
  length_mm: string
  width_mm: string
  height_mm: string
}

export const newKey = (): string => Math.random().toString(36).slice(2, 10)

export const emptyVariantRow = (optionValues: Record<string, string>): VariantRow => ({
  key: newKey(),
  option_values: optionValues,
  vendor_sku: "",
  payout_price: "",
  mrp: "",
  net_quantity_value: "",
  net_quantity_unit: "",
  weight_g: "",
  length_mm: "",
  width_mm: "",
  height_mm: "",
})

/** Digits and at most one dot. */
export const sanitizeDecimal = (value: string): string => {
  const cleaned = value.replace(/[^\d.]/g, "")
  const dot = cleaned.indexOf(".")
  return dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`
}

export const sanitizeDigits = (value: string): string => value.replace(/\D/g, "")

type Column = {
  field: keyof VariantRow
  label: string
  kind: "text" | "money" | "decimal" | "digits" | "unit"
  width: string
}

const COLUMNS: Column[] = [
  { field: "vendor_sku", label: "Vendor SKU", kind: "text", width: "w-36" },
  { field: "payout_price", label: "Payout price (INR)", kind: "money", width: "w-32" },
  { field: "mrp", label: "MRP (INR)", kind: "money", width: "w-28" },
  { field: "net_quantity_value", label: "Net quantity", kind: "decimal", width: "w-24" },
  { field: "net_quantity_unit", label: "Net quantity unit", kind: "unit", width: "w-24" },
  { field: "weight_g", label: "Weight (g)", kind: "digits", width: "w-24" },
  { field: "length_mm", label: "Length (mm)", kind: "digits", width: "w-24" },
  { field: "width_mm", label: "Width (mm)", kind: "digits", width: "w-24" },
  { field: "height_mm", label: "Height (mm)", kind: "digits", width: "w-24" },
]

const UNITS = ["g", "kg", "ml", "l", "pcs"]

type VariantsTableProps = {
  rows: VariantRow[]
  onChange: (rows: VariantRow[]) => void
  errorFor: (path: string) => string | undefined
}

const describeOptions = (optionValues: Record<string, string>): string =>
  Object.entries(optionValues)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ")

export const VariantsTable = ({ rows, onChange, errorFor }: VariantsTableProps) => {
  const update = (index: number, patch: Partial<VariantRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))

  const sanitize = (kind: Column["kind"], value: string): string => {
    if (kind === "money" || kind === "decimal") return sanitizeDecimal(value)
    if (kind === "digits") return sanitizeDigits(value)
    return value
  }

  return (
    <div className="max-w-full overflow-x-auto rounded-md bg-ui-bg-base shadow-elevation-card-rest" data-testid="variants-table">
      <table className="w-max min-w-full text-left txt-small">
        <thead className="border-b border-ui-border-base text-ui-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2">
              Variant
            </th>
            {COLUMNS.map((column) => (
              <th key={column.field} scope="col" className="px-3 py-2">
                {column.label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const n = index + 1
            return (
              <tr key={row.key} className="border-b border-ui-border-base align-top last:border-0">
                <th scope="row" className="px-3 py-2 txt-small-plus whitespace-nowrap">
                  {describeOptions(row.option_values) || `Variant ${n}`}
                  {errorFor(`variants.${index}.option_values`) && (
                    <span
                      className="block font-normal text-ui-fg-error"
                      data-field-error="true"
                      data-testid={`error-variants.${index}.option_values`}
                    >
                      {errorFor(`variants.${index}.option_values`)}
                    </span>
                  )}
                </th>
                {COLUMNS.map((column) => {
                  const path = `variants.${index}.${column.field}`
                  const message = errorFor(path)
                  const label = `${column.label}, variant ${n}`
                  const value = row[column.field] as string
                  return (
                    <td key={column.field} className={`px-3 py-2 ${column.width}`}>
                      {column.kind === "unit" ? (
                        <select
                          aria-label={label}
                          aria-invalid={message ? true : undefined}
                          value={value}
                          onChange={(event) => update(index, { [column.field]: event.target.value })}
                          className="h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 txt-small"
                        >
                          <option value="">None</option>
                          {UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center gap-x-1">
                          {column.kind === "money" && <span aria-hidden="true">₹</span>}
                          <Input
                            size="small"
                            aria-label={label}
                            aria-invalid={message ? true : undefined}
                            inputMode={column.kind === "text" ? undefined : "decimal"}
                            value={value}
                            maxLength={column.kind === "text" ? 40 : undefined}
                            onChange={(event) =>
                              update(index, { [column.field]: sanitize(column.kind, event.target.value) })
                            }
                          />
                        </div>
                      )}
                      {message && (
                        <p
                          className="mt-1 txt-small text-ui-fg-error"
                          data-field-error="true"
                          data-testid={`error-${path}`}
                        >
                          {message}
                        </p>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    disabled={rows.length === 1}
                    aria-label={`Remove variant ${n}`}
                    onClick={() => onChange(rows.filter((_, position) => position !== index))}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
