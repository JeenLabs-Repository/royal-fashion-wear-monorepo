"use client"

import IndiaAddressFields from "./providers/india"
import type { AddressAutocompleteProps } from "./types"

export type { AddressFields } from "./types"

const AddressAutocomplete = (props: AddressAutocompleteProps) => (
  <div className="flex flex-col gap-y-3">
    <IndiaAddressFields {...props} />
  </div>
)

export default AddressAutocomplete
