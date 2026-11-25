"use client"

import type React from "react"
import { useEffect, useId, useRef, useState } from "react"
import { lookupPincode, type PincodeLookup } from "@lib/data/pincode"
import { INDIA_STATES, PIN_PATTERN, stateLabel } from "@lib/util/india-states"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { useTranslations } from "next-intl"
import type { AddressAutocompleteProps } from "../types"

const LOOKUP_DELAY_MS = 300

type LookupState = {
  pin: string
  result: PincodeLookup
  /** True when this lookup wrote the state (and maybe the city) into the form. */
  filled: boolean
}

const SORTED_STATES = [...INDIA_STATES].sort((a, b) =>
  a.label.localeCompare(b.label, "en")
)

/**
 * Address fields for India: country fixed, PIN first, state and city filled
 * from the PIN after the sixth digit, street by hand. Every control carries its
 * form `name` (and a hidden country code is rendered), so a form that submits
 * as form data can use it without extra wiring. An unknown PIN never blocks:
 * the customer keeps editing state and city, and the server decides on save.
 */
const IndiaAddressFields = ({
  values,
  onChange,
  required,
}: AddressAutocompleteProps) => {
  const t = useTranslations("CheckoutPage")
  const stateId = useId()
  const localityId = useId()
  const [lookup, setLookup] = useState<LookupState | null>(null)

  // The lookup finishes after the customer may have typed more, so the callback
  // reads the latest values and handler through refs instead of its closure.
  const valuesRef = useRef(values)
  const onChangeRef = useRef(onChange)
  const filledCity = useRef("")
  const initialPin = useRef(values.postal_code)

  useEffect(() => {
    valuesRef.current = values
    onChangeRef.current = onChange
  })

  const pin = values.postal_code

  useEffect(() => {
    if (!PIN_PATTERN.test(pin)) {
      setLookup(null)
      return
    }

    const timer = setTimeout(async () => {
      const result = await lookupPincode(pin)
      const current = valuesRef.current
      // A response for a PIN that is no longer in the field is stale.
      if (current.postal_code !== pin) return

      // A saved address keeps its own state until the PIN changes.
      let filled = false
      if (result.found && (pin !== initialPin.current || current.province === "")) {
        const cityIsOurs =
          current.city.trim() === "" || current.city === filledCity.current
        const city = cityIsOurs ? result.city : current.city
        if (cityIsOurs) filledCity.current = result.city
        filled = true
        onChangeRef.current({ ...current, province: result.province, city })
      }
      setLookup({ pin, result, filled })
    }, LOOKUP_DELAY_MS)

    return () => clearTimeout(timer)
  }, [pin])

  const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...values, [e.target.name]: e.target.value })
  }

  const handlePin = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...values,
      postal_code: e.target.value.replace(/\D/g, "").slice(0, 6),
    })
  }

  const handleState = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...values, province: e.target.value })
  }

  const handleLocality = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const locality = e.target.value
    if (locality && values.address_1.trim() === "") {
      onChange({ ...values, address_1: locality })
    }
  }

  // A province that is not in the list (an older free-text value) shows as
  // unselected, so the customer must pick a state before saving.
  const provinceValue = INDIA_STATES.some((state) => state.value === values.province)
    ? values.province
    : ""

  const current = lookup && lookup.pin === pin ? lookup : null
  const result = current?.result
  const verified = result && result.found ? result : null

  let hint: { text: string; warn: boolean } | null = null
  if (result && !result.found) {
    hint = { text: t("pinHintUnknown"), warn: false }
  } else if (verified && provinceValue && provinceValue !== verified.province) {
    hint = {
      text: t("pinHintMismatch", { state: stateLabel(verified.province) }),
      warn: true,
    }
  } else if (verified && current?.filled) {
    hint = { text: t("pinHintFilled"), warn: false }
  }

  const localities = verified?.localities ?? []

  return (
    <>
      <div className="flex flex-col" data-testid="shipping-country-readonly">
        <span className="txt-compact-small text-ui-fg-subtle">
          {t("fieldCountry")}
        </span>
        <span className="txt-compact-medium">{t("countryIndia")}</span>
      </div>
      <input type="hidden" name="country_code" value="in" />

      <Input
        label={t("fieldPin")}
        name="postal_code"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={6}
        value={values.postal_code}
        onChange={handlePin}
        required={required}
        data-testid="shipping-pin-input"
      />
      <p
        role="status"
        aria-live="polite"
        data-testid="pin-hint"
        className={
          hint?.warn
            ? "txt-compact-small text-ui-fg-error empty:hidden"
            : "txt-compact-small text-ui-fg-subtle empty:hidden"
        }
      >
        {hint?.text}
      </p>

      <div className="flex flex-col gap-y-1">
        <label htmlFor={stateId} className="txt-compact-small text-ui-fg-subtle">
          {t("fieldState")}
        </label>
        <NativeSelect
          id={stateId}
          name="province"
          value={provinceValue}
          onChange={handleState}
          required={required}
          placeholder={t("fieldState")}
          data-testid="shipping-state-select"
        >
          {SORTED_STATES.map((state) => (
            <option key={state.value} value={state.value}>
              {state.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Input
        label={t("fieldCity")}
        name="city"
        autoComplete="address-level2"
        value={values.city}
        onChange={handleText}
        required={required}
        data-testid="shipping-city-input"
      />

      {localities.length > 0 && (
        <div className="flex flex-col gap-y-1">
          <label
            htmlFor={localityId}
            className="txt-compact-small text-ui-fg-subtle"
          >
            {t("fieldLocality")}
          </label>
          <NativeSelect
            key={current?.pin}
            id={localityId}
            defaultValue=""
            onChange={handleLocality}
            placeholder={t("fieldLocality")}
            data-testid="shipping-locality-select"
          >
            {localities.map((locality) => (
              <option key={locality} value={locality}>
                {locality}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <Input
        label={t("fieldAddress")}
        name="address_1"
        autoComplete="address-line1"
        value={values.address_1}
        onChange={handleText}
        required={required}
        data-testid="shipping-address-input"
      />
    </>
  )
}

export default IndiaAddressFields
