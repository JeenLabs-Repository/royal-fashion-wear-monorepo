"use client"

import {
  deleteCustomerAddress,
  updateCustomerAddress,
} from "@lib/data/customer"
import useToggleState from "@lib/hooks/use-toggle-state"
import { PencilSquare as Edit, Trash } from "@medusajs/icons"
import type { HttpTypes } from "@medusajs/types"
import { Badge, Button, Heading, Text, clx } from "@medusajs/ui"
import { formatAddressLines } from "@lib/util/address"
import { CheckoutModal } from "@modules/checkout/components/checkout-modal"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import type { AddressFields } from "@modules/common/components/address-autocomplete"
import IndiaAddressFields from "@modules/common/components/address-autocomplete/providers/india"
import Input from "@modules/common/components/input"
import Spinner from "@modules/common/icons/spinner"
import type React from "react"
import { useActionState, useEffect, useState } from "react"
import { useTranslations } from "next-intl"

const fieldsOf = (address: HttpTypes.StoreCustomerAddress): AddressFields => ({
  address_1: address.address_1 ?? "",
  postal_code: address.postal_code ?? "",
  city: address.city ?? "",
  province: address.province ?? "",
})

type EditAddressProps = {
  region: HttpTypes.StoreRegion
  address: HttpTypes.StoreCustomerAddress
  isActive?: boolean
}

// The country is fixed to India, so the region the parent passes is not read.
const EditAddress: React.FC<EditAddressProps> = ({
  region: _region,
  address,
  isActive = false,
}) => {
  const t = useTranslations("AddressCard")
  const tf = useTranslations("AddressForm")
  const [removing, setRemoving] = useState(false)
  const [successState, setSuccessState] = useState(false)
  const { state, open, close: closeModal } = useToggleState(false)
  const [fields, setFields] = useState<AddressFields>(() => fieldsOf(address))

  // Start every edit from the saved address, not from an earlier unsaved edit.
  const openEditor = () => {
    setFields(fieldsOf(address))
    open()
  }

  const [formState, formAction] = useActionState(updateCustomerAddress, {
    success: false,
    error: null,
  } as { success: boolean; error: string | null })

  const close = () => {
    setSuccessState(false)
    closeModal()
  }

  useEffect(() => {
    if (successState) {
      close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successState])

  useEffect(() => {
    if (formState.success) {
      setSuccessState(true)
    }
  }, [formState])

  const addressLines = formatAddressLines(address)

  const removeAddress = async () => {
    setRemoving(true)
    await deleteCustomerAddress(address.id)
    setRemoving(false)
  }

  return (
    <>
      <div
        className={clx(
          "border border-ui-border-base rounded-lg p-5 min-h-[220px] h-full w-full flex flex-col justify-between transition-colors",
          {
            "border-ui-border-interactive": isActive,
          }
        )}
        data-testid="address-container"
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-x-2">
            <Heading
              level="h2"
              className="text-start text-base-semi"
              data-testid="address-name"
            >
              {address.address_name}
            </Heading>
            {address.is_default_shipping && (
              <Badge size="2xsmall" color="grey" data-testid="address-default">
                {t("default")}
              </Badge>
            )}
          </div>
          <Text
            className="flex flex-col text-start text-base-regular mt-2"
            data-testid="address-address"
          >
            {addressLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </Text>
        </div>
        <div className="flex items-center gap-x-4">
          <button
            className="text-small-regular text-ui-fg-base flex items-center gap-x-2"
            onClick={openEditor}
            data-testid="address-edit-button"
          >
            <Edit />
            {tf("edit")}
          </button>
          <button
            className="text-small-regular text-ui-fg-base flex items-center gap-x-2"
            onClick={removeAddress}
            data-testid="address-delete-button"
          >
            {removing ? <Spinner /> : <Trash />}
            {tf("remove")}
          </button>
        </div>
      </div>

      <CheckoutModal open={state} onClose={close} title={t("editAddress")}>
        <form action={formAction} className="flex flex-col" data-testid="edit-address-modal">
          <input type="hidden" name="addressId" value={address.id} />
          <div className="flex flex-col gap-y-3">
            <Input
              label={tf("addressName")}
              name="address_name"
              required
              autoComplete="address_name"
              defaultValue={address.address_name || undefined}
              data-testid="addres-name-input"
            />
            <Input
              label={tf("company")}
              name="company"
              autoComplete="organization"
              defaultValue={address.company || undefined}
              data-testid="company-input"
            />
            <IndiaAddressFields values={fields} onChange={setFields} required />
            <Input
              label={tf("addressLine2")}
              name="address_2"
              autoComplete="address-line2"
              defaultValue={address.address_2 || undefined}
              data-testid="address-2-input"
            />
            <Input
              label={tf("phone")}
              name="phone"
              autoComplete="phone"
              defaultValue={address.phone || undefined}
              data-testid="phone-input"
            />
          </div>

          <ErrorMessage error={formState.error} data-testid="address-error" />

          <div className="flex gap-x-2 mt-4">
            <Button
              type="button"
              onClick={close}
              variant="secondary"
              size="large"
              className="w-full"
              data-testid="cancel-button"
            >
              {tf("cancel")}
            </Button>
            <SubmitButton className="w-full" data-testid="save-button">
              {tf("save")}
            </SubmitButton>
          </div>
        </form>
      </CheckoutModal>
    </>
  )
}

export default EditAddress
