"use client"

import React, { useActionState, useEffect, useMemo } from "react"

import type { AddressFields } from "@modules/common/components/address-autocomplete"
import IndiaAddressFields from "@modules/common/components/address-autocomplete/providers/india"
import Input from "@modules/common/components/input"

import { addCustomerAddress, updateCustomerAddress } from "@lib/data/customer"
import type { HttpTypes } from "@medusajs/types"
import AccountInfo from "../account-info"
import { useTranslations } from "next-intl"
import { formatAddressLines } from "@lib/util/address"

const fieldsOf = (address?: HttpTypes.StoreCustomerAddress): AddressFields => ({
  address_1: address?.address_1 ?? "",
  postal_code: address?.postal_code ?? "",
  city: address?.city ?? "",
  province: address?.province ?? "",
})

type MyInformationProps = {
  customer: HttpTypes.StoreCustomer
  regions: HttpTypes.StoreRegion[]
}

const ProfileBillingAddress: React.FC<MyInformationProps> = ({
  customer,
  regions,
}) => {
  const t = useTranslations("ProfileBillingAddress")
  const tf = useTranslations("AddressForm")
  const regionOptions = useMemo(() => {
    return (
      regions
        ?.flatMap((region) => {
          return region.countries?.map((country) => ({
            value: country.iso_2,
            label: country.display_name,
          }))
        }) || []
    )
  }, [regions])

  const [successState, setSuccessState] = React.useState(false)

  const billingAddress = customer.addresses?.find(
    (addr) => addr.is_default_billing
  )

  const [fields, setFields] = React.useState<AddressFields>(() =>
    fieldsOf(billingAddress)
  )

  const initialState: Record<string, unknown> = {
    isDefaultBilling: true,
    isDefaultShipping: false,
    error: false,
    success: false,
  }

  if (billingAddress) {
    initialState.addressId = billingAddress.id
  }

  const [state, formAction] = useActionState(
    billingAddress ? updateCustomerAddress : addCustomerAddress,
    initialState
  )

  const clearState = () => {
    setSuccessState(false)
  }

  useEffect(() => {
    setSuccessState(!!state.success)
  }, [state])

  const currentInfo = useMemo(() => {
    if (!billingAddress) {
      return t("noBillingAddress")
    }

    const country =
      regionOptions?.find(
        (country) => country?.value === billingAddress.country_code
      )?.label || billingAddress.country_code?.toUpperCase()

    return (
      <div className="flex flex-col font-semibold" data-testid="current-info">
        {formatAddressLines(billingAddress, country).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    )
  }, [billingAddress, regionOptions, t])

  return (
    <form
      action={formAction}
      onReset={() => {
        clearState()
        setFields(fieldsOf(billingAddress))
      }}
      className="w-full"
    >
      <input type="hidden" name="addressId" value={billingAddress?.id} />
      <AccountInfo
        label={t("billingAddress")}
        currentInfo={currentInfo}
        isSuccess={successState}
        isError={!!state.error}
        clearState={clearState}
        data-testid="account-billing-address-editor"
      >
        <div className="grid grid-cols-1 gap-y-2">
          <div className="grid grid-cols-2 gap-x-2">
            <Input
              label={tf("firstName")}
              name="first_name"
              defaultValue={billingAddress?.first_name || undefined}
              required
              data-testid="billing-first-name-input"
            />
            <Input
              label={tf("lastName")}
              name="last_name"
              defaultValue={billingAddress?.last_name || undefined}
              required
              data-testid="billing-last-name-input"
            />
          </div>
          <Input
            label={tf("company")}
            name="company"
            defaultValue={billingAddress?.company || undefined}
            data-testid="billing-company-input"
          />
          <Input
            label={tf("phone")}
            name="phone"
            type="phone"
            autoComplete="phone"
            required
            defaultValue={billingAddress?.phone ?? customer?.phone ?? ""}
            data-testid="billing-phone-input"
          />
          <IndiaAddressFields values={fields} onChange={setFields} required />
          <Input
            label={tf("addressLine2")}
            name="address_2"
            defaultValue={billingAddress?.address_2 || undefined}
            data-testid="billing-address-2-input"
          />
        </div>
      </AccountInfo>
    </form>
  )
}

export default ProfileBillingAddress
