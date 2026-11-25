import { Input, Textarea } from "@medusajs/ui"
import { COUNTRIES } from "../../lib/countries"

export type DeclarationState = {
  generic_name: string
  country_of_origin: string
  packed_by_name: string
  packed_by_address: string
}

export const emptyDeclaration = (): DeclarationState => ({
  generic_name: "",
  country_of_origin: "IN",
  packed_by_name: "",
  packed_by_address: "",
})

type DeclarationFieldsProps = {
  value: DeclarationState
  onChange: (value: DeclarationState) => void
  errorFor: (path: string) => string | undefined
}

const FieldError = ({ path, message }: { path: string; message?: string }) =>
  message ? (
    <p className="txt-small text-ui-fg-error" data-field-error="true" data-testid={`error-${path}`}>
      {message}
    </p>
  ) : null

// Legal Metrology fields. What a customer sees of them is decided by the store.
export const DeclarationFields = ({ value, onChange, errorFor }: DeclarationFieldsProps) => {
  const set = (patch: Partial<DeclarationState>) => onChange({ ...value, ...patch })

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-y-1">
        <label htmlFor="declaration-generic-name" className="txt-small-plus">
          Generic name
        </label>
        <Input
          id="declaration-generic-name"
          value={value.generic_name}
          aria-invalid={errorFor("declaration.generic_name") ? true : undefined}
          onChange={(event) => set({ generic_name: event.target.value })}
        />
        <FieldError path="declaration.generic_name" message={errorFor("declaration.generic_name")} />
      </div>

      <div className="flex flex-col gap-y-1">
        <label htmlFor="declaration-country" className="txt-small-plus">
          Country of origin
        </label>
        <select
          id="declaration-country"
          value={value.country_of_origin}
          aria-invalid={errorFor("declaration.country_of_origin") ? true : undefined}
          onChange={(event) => set({ country_of_origin: event.target.value })}
          className="h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 txt-small"
        >
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        <FieldError path="declaration.country_of_origin" message={errorFor("declaration.country_of_origin")} />
      </div>

      <div className="flex flex-col gap-y-1">
        <label htmlFor="declaration-packed-by-name" className="txt-small-plus">
          Packed or marketed by (name)
        </label>
        <Input
          id="declaration-packed-by-name"
          value={value.packed_by_name}
          aria-invalid={errorFor("declaration.packed_by_name") ? true : undefined}
          onChange={(event) => set({ packed_by_name: event.target.value })}
        />
        <FieldError path="declaration.packed_by_name" message={errorFor("declaration.packed_by_name")} />
      </div>

      <div className="flex flex-col gap-y-1">
        <label htmlFor="declaration-packed-by-address" className="txt-small-plus">
          Packed or marketed by (address)
        </label>
        <Textarea
          id="declaration-packed-by-address"
          rows={3}
          value={value.packed_by_address}
          aria-invalid={errorFor("declaration.packed_by_address") ? true : undefined}
          onChange={(event) => set({ packed_by_address: event.target.value })}
        />
        <FieldError path="declaration.packed_by_address" message={errorFor("declaration.packed_by_address")} />
      </div>
    </div>
  )
}
