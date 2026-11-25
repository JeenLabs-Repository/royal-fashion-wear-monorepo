import { Button, Heading, Input, Prompt, Text, Textarea } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { DeclarationFields, emptyDeclaration, type DeclarationState } from "../components/products/DeclarationFields"
import { ImagePicker } from "../components/products/ImagePicker"
import { StateChip } from "../components/products/StateChip"
import {
  VariantsTable,
  emptyVariantRow,
  newKey,
  type VariantRow,
} from "../components/products/VariantsTable"
import { StatusBanner } from "../components/StatusBanner"
import {
  NO_ERRORS,
  errorFor,
  errorsUnder,
  issuesToFieldErrors,
  type FieldErrors,
} from "../lib/api/field-errors"
import {
  useCategories,
  useDiscardPending,
  useProduct,
  useSaveProduct,
  useSubmitProduct,
  useWithdrawProduct,
  type ProductBody,
  type ProductContent,
} from "../lib/api/products"
import type { ImageItem } from "../lib/api/uploads"
import { ApiError, errorText } from "../lib/errors"
import { useSession } from "../lib/session"
import { NotFound } from "./NotFound"

const TITLE_MAX = 150
const DESCRIPTION_MAX = 5000
const MAX_OPTIONS = 3
const MAX_VARIANTS = 50

const LIVE_EDIT_CONFIRM =
  "Your change goes to review. The live version stays on sale until the change is approved."
const WITHDRAW_CONFIRM =
  "Withdrawing takes this product off sale. You can edit it and send it for review again."
const IN_REVIEW_TEXT = "This product is in review and cannot be changed"

const GST_CHOICES = [
  { value: "GST-0", label: "GST 0%" },
  { value: "GST-5", label: "GST 5%" },
  { value: "GST-18", label: "GST 18%" },
  { value: "GST-40", label: "GST 40%" },
  { value: "not_sure", label: "Not sure" },
]

type OptionRow = { key: string; name: string; values: string }

type FormState = {
  title: string
  description: string
  categoryId: string
  gstClass: string
  hsn: string
  images: ImageItem[]
  options: OptionRow[]
  variants: VariantRow[]
  declaration: DeclarationState
}

type Confirm = null | "save" | "submit" | "withdraw" | "discard"

const DEFAULT_OPTION = { Title: "Default" }

const emptyForm = (): FormState => ({
  title: "",
  description: "",
  categoryId: "",
  gstClass: "not_sure",
  hsn: "",
  images: [],
  options: [],
  variants: [emptyVariantRow(DEFAULT_OPTION)],
  declaration: emptyDeclaration(),
})

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value))

const isDefaultOptions = (options: ProductContent["options"]): boolean =>
  options.length === 1 &&
  options[0].title === "Title" &&
  options[0].values.length === 1 &&
  options[0].values[0] === "Default"

const toFormState = (content: ProductContent): FormState => ({
  title: content.title,
  description: content.description,
  categoryId: text(content.proposed_category_id),
  gstClass: content.proposed_gst_class ?? "not_sure",
  hsn: text(content.proposed_hsn),
  images: content.images.map((image) => ({ upload_id: image.upload_id, url: image.url ?? "" })),
  options: isDefaultOptions(content.options)
    ? []
    : content.options.map((option) => ({ key: newKey(), name: option.title, values: option.values.join(", ") })),
  variants: content.variants.map((variant) => ({
    key: newKey(),
    variant_id: variant.variant_id,
    option_values: variant.option_values,
    vendor_sku: variant.vendor_sku,
    payout_price: text(variant.payout_price),
    mrp: text(variant.mrp),
    net_quantity_value: text(variant.net_quantity_value),
    net_quantity_unit: text(variant.net_quantity_unit),
    weight_g: text(variant.weight_g),
    length_mm: text(variant.length_mm),
    width_mm: text(variant.width_mm),
    height_mm: text(variant.height_mm),
  })),
  declaration: {
    generic_name: text(content.declaration?.generic_name),
    country_of_origin: content.declaration?.country_of_origin ?? "IN",
    packed_by_name: text(content.declaration?.packed_by_name),
    packed_by_address: text(content.declaration?.packed_by_address),
  },
})

const parseOptions = (options: OptionRow[]) =>
  options
    .map((option) => ({
      name: option.name.trim(),
      values: [...new Set(option.values.split(",").map((value) => value.trim()).filter(Boolean))],
    }))
    .filter((option) => option.name && option.values.length > 0)

const combinations = (options: { name: string; values: string[] }[]): Record<string, string>[] =>
  options.reduce<Record<string, string>[]>(
    (rows, option) => rows.flatMap((row) => option.values.map((value) => ({ ...row, [option.name]: value }))),
    [{}]
  )

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const numberOrUndefined = (value: string): number | undefined => {
  const parsed = Number(value)
  return value.trim() === "" || Number.isNaN(parsed) ? undefined : parsed
}

const toBody = (form: FormState): ProductBody => {
  const parsed = parseOptions(form.options)
  const declaration = Object.fromEntries(
    Object.entries(form.declaration)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value !== "")
  )
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    images: form.images.map((image) => ({ upload_id: image.upload_id })),
    options: parsed.length
      ? parsed.map((option) => ({ title: option.name, values: option.values }))
      : [{ title: "Title", values: ["Default"] }],
    variants: form.variants.map((row) => ({
      ...optional("variant_id", row.variant_id),
      vendor_sku: row.vendor_sku.trim(),
      option_values: row.option_values,
      payout_price: row.payout_price.trim(),
      ...optional("mrp", row.mrp.trim() || undefined),
      ...optional("net_quantity_value", numberOrUndefined(row.net_quantity_value)),
      ...optional("net_quantity_unit", row.net_quantity_unit || undefined),
      ...optional("weight_g", numberOrUndefined(row.weight_g)),
      ...optional("length_mm", numberOrUndefined(row.length_mm)),
      ...optional("width_mm", numberOrUndefined(row.width_mm)),
      ...optional("height_mm", numberOrUndefined(row.height_mm)),
    })),
    proposed_category_id: form.categoryId || undefined,
    proposed_gst_class: form.gstClass || "not_sure",
    proposed_hsn: form.hsn.trim() || undefined,
    declaration,
  }
}

const ConfirmPrompt = (props: {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
}) => (
  <Prompt open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
    <Prompt.Content>
      <Prompt.Header>
        <Prompt.Title>{props.title}</Prompt.Title>
        <Prompt.Description>{props.description}</Prompt.Description>
      </Prompt.Header>
      <Prompt.Footer>
        <Prompt.Cancel onClick={props.onCancel}>Cancel</Prompt.Cancel>
        <Prompt.Action onClick={props.onConfirm}>Confirm</Prompt.Action>
      </Prompt.Footer>
    </Prompt.Content>
  </Prompt>
)

const FieldError = ({ path, message }: { path: string; message?: string }) =>
  message ? (
    <p className="txt-small text-ui-fg-error" data-field-error="true" data-testid={`error-${path}`}>
      {message}
    </p>
  ) : null

const selectClass = "h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 txt-small"

export const ProductForm = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { me } = useSession()
  const prefill = (location.state as { prefill?: FormState } | null)?.prefill
  const justCreated = Boolean((location.state as { saved?: boolean } | null)?.saved)

  const query = useProduct(id)
  const categories = useCategories()
  const save = useSaveProduct()
  const submit = useSubmitProduct()
  const withdraw = useWithdrawProduct()
  const discard = useDiscardPending()

  const [form, setForm] = useState<FormState>(() => prefill ?? emptyForm())
  const [baseline, setBaseline] = useState(() => JSON.stringify(prefill ?? form))
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS)
  const [saved, setSaved] = useState(justCreated)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [generateNote, setGenerateNote] = useState<string | null>(null)

  // The form takes the stored content each time the detail loads or reloads.
  useEffect(() => {
    if (id && query.data) {
      const next = toFormState(query.data.product.content)
      setForm(next)
      setBaseline(JSON.stringify(next))
    }
    // The detail query's own timestamp is the trigger; `query.data` itself would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query.dataUpdatedAt])

  useEffect(() => {
    if (Object.keys(errors.fields).length > 0) {
      document.querySelector("[data-field-error]")?.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }, [errors])

  if (id && query.isLoading) {
    return (
      <span
        role="status"
        aria-label="Loading"
        className="block size-5 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
      />
    )
  }
  if (id && query.isError) {
    const failure = query.error
    if (failure instanceof ApiError && failure.status === 404) {
      return <NotFound />
    }
    return (
      <div className="flex flex-col items-start gap-y-2" role="alert">
        <Text className="text-ui-fg-error">{errorText(failure)}</Text>
        <Button size="small" variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const detail = query.data?.product
  const mode = !id
    ? "new"
    : detail?.state === "rejected"
      ? "rejected"
      : detail?.state === "submitted" && !detail.is_live
        ? "locked"
        : "edit"
  const readOnly = mode === "locked" || mode === "rejected"
  const liveMode = Boolean(detail?.is_live) && mode === "edit"
  const dirty = JSON.stringify(form) !== baseline
  const canSubmit = mode === "edit" && Boolean(detail && ["draft", "withdrawn", "changes_requested"].includes(detail.state))
  const canWithdraw = Boolean(detail && ["submitted", "approved", "changes_requested"].includes(detail.state))
  const showDiscard = Boolean(detail?.is_live && detail.has_pending)
  const busy = save.isPending || submit.isPending || withdraw.isPending || discard.isPending
  const err = (path: string) => errorFor(errors, path)

  const patch = (change: Partial<FormState>) => {
    setSaved(false)
    setForm((current) => ({ ...current, ...change }))
  }

  const setOption = (key: string, change: Partial<OptionRow>) =>
    patch({ options: form.options.map((option) => (option.key === key ? { ...option, ...change } : option)) })

  const generateVariants = () => {
    const parsed = parseOptions(form.options)
    const combos = combinations(parsed)
    if (combos.length > MAX_VARIANTS) {
      setGenerateNote(`These options make ${combos.length} variants. A product holds at most ${MAX_VARIANTS}.`)
      return
    }
    setGenerateNote(null)
    const target = parsed.length ? combos : [DEFAULT_OPTION]
    const existing = new Map(form.variants.map((row) => [JSON.stringify(row.option_values), row]))
    patch({ variants: target.map((combo) => existing.get(JSON.stringify(combo)) ?? emptyVariantRow(combo)) })
  }

  const run = async <T,>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    setErrors(NO_ERRORS)
    try {
      return { ok: true, value: await action() }
    } catch (failure) {
      setErrors(issuesToFieldErrors(failure))
      return { ok: false }
    }
  }

  const doSave = async () => {
    setConfirm(null)
    const outcome = await run(() => save.mutateAsync({ id: id ?? null, body: toBody(form) }))
    if (!outcome.ok) return
    setSaved(true)
    setBaseline(JSON.stringify(form))
    const createdId = outcome.value.product?.id
    if (!id && createdId) {
      navigate(`/products/${createdId}`, { replace: true, state: { saved: true } })
    }
  }

  const onSaveClick = () => (liveMode ? setConfirm("save") : void doSave())

  const afterAction = async (action: () => Promise<unknown>) => {
    setConfirm(null)
    if ((await run(action)).ok) {
      setSaved(false)
      await query.refetch()
    }
  }

  const startFromRejected = () => {
    const base = toFormState(detail!.content)
    navigate("/products/new", {
      state: {
        prefill: {
          ...base,
          images: [],
          // Vendor SKUs are unique per vendor, so the new draft asks for them again.
          variants: base.variants.map((row) => ({ ...row, key: newKey(), variant_id: undefined, vendor_sku: "" })),
        },
      },
    })
  }

  return (
    <div className="flex flex-col gap-y-6" data-testid="screen-product-form">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level="h1">{mode === "new" ? "Create product" : "Product"}</Heading>
        {detail && <StateChip state={detail.state} is_live={detail.is_live} has_pending={detail.has_pending} />}
      </div>

      {me?.vendor.eligible_to_list === false && (
        <StatusBanner tone="warning">
          Your account is not active yet. You can save drafts when the store team activates it.
        </StatusBanner>
      )}
      {detail?.reason && (detail.state === "changes_requested" || detail.state === "rejected") && (
        <StatusBanner tone="warning">
          {detail.state === "rejected" ? "The store team rejected this product: " : "The store team asked for changes: "}
          {detail.reason}
        </StatusBanner>
      )}
      {mode === "locked" && <StatusBanner tone="info">{IN_REVIEW_TEXT}</StatusBanner>}
      {mode === "rejected" && (
        <div className="flex flex-col items-start gap-y-2">
          <Text>This product was rejected and cannot be changed.</Text>
          <Button variant="secondary" onClick={startFromRejected}>
            Start a new draft from this one
          </Button>
        </div>
      )}
      {showDiscard && (
        <div className="flex flex-wrap items-center gap-3">
          <StatusBanner tone="info">Change waiting for review</StatusBanner>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm("discard")}>
            Discard pending change
          </Button>
        </div>
      )}
      {errors.form && <StatusBanner tone="error">{errors.form}</StatusBanner>}
      {saved && !errors.form && (
        <StatusBanner tone="success">
          <span data-testid="form-saved">{liveMode ? "Change saved." : "Draft saved."}</span>
        </StatusBanner>
      )}

      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-y-8 border-0 p-0">
        <section className="flex flex-col gap-y-4" aria-labelledby="section-basics">
          <Heading level="h2" id="section-basics">
            Basics
          </Heading>
          <div className="flex flex-col gap-y-1">
            <label htmlFor="product-title" className="txt-small-plus">
              Title
            </label>
            <Input
              id="product-title"
              value={form.title}
              maxLength={TITLE_MAX}
              aria-invalid={err("title") ? true : undefined}
              onChange={(event) => patch({ title: event.target.value })}
            />
            <Text size="small" className="text-ui-fg-subtle">
              {form.title.length} of {TITLE_MAX}
            </Text>
            <FieldError path="title" message={err("title")} />
          </div>

          <div className="flex flex-col gap-y-1">
            <label htmlFor="product-description" className="txt-small-plus">
              Description
            </label>
            <Textarea
              id="product-description"
              rows={6}
              value={form.description}
              aria-invalid={err("description") ? true : undefined}
              onChange={(event) => patch({ description: event.target.value })}
            />
            <Text size="small" className="text-ui-fg-subtle">
              {form.description.length} of {DESCRIPTION_MAX}. Plain text is kept and tags are removed.
            </Text>
            <FieldError path="description" message={err("description")} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-y-1">
              <label htmlFor="product-category" className="txt-small-plus">
                Category
              </label>
              <select
                id="product-category"
                value={form.categoryId}
                className={selectClass}
                aria-invalid={err("proposed_category_id") ? true : undefined}
                onChange={(event) => patch({ categoryId: event.target.value })}
              >
                <option value="">Choose a category</option>
                {(categories.data?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <FieldError path="proposed_category_id" message={err("proposed_category_id")} />
            </div>
            <div className="flex flex-col gap-y-1">
              <label htmlFor="product-gst" className="txt-small-plus">
                GST class
              </label>
              <select
                id="product-gst"
                value={form.gstClass}
                className={selectClass}
                aria-invalid={err("proposed_gst_class") ? true : undefined}
                onChange={(event) => patch({ gstClass: event.target.value })}
              >
                {GST_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <FieldError path="proposed_gst_class" message={err("proposed_gst_class")} />
            </div>
            <div className="flex flex-col gap-y-1">
              <label htmlFor="product-hsn" className="txt-small-plus">
                HSN code
              </label>
              <Input
                id="product-hsn"
                inputMode="numeric"
                maxLength={8}
                value={form.hsn}
                aria-invalid={err("proposed_hsn") ? true : undefined}
                onChange={(event) => patch({ hsn: event.target.value.replace(/\D/g, "") })}
              />
              <Text size="small" className="text-ui-fg-subtle">
                4, 6 or 8 digits. Leave empty if you are not sure.
              </Text>
              <FieldError path="proposed_hsn" message={err("proposed_hsn")} />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-y-4" aria-labelledby="section-images">
          <Heading level="h2" id="section-images">
            Images
          </Heading>
          <ImagePicker value={form.images} onChange={(images) => patch({ images })} error={errorsUnder(errors, "images")[0]} />
        </section>

        <section className="flex flex-col gap-y-4" aria-labelledby="section-variants">
          <Heading level="h2" id="section-variants">
            Options and variants
          </Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Add options such as Size or Color, then generate the variants. Generate again after you change an option.
          </Text>

          {form.options.map((option, index) => {
            const n = index + 1
            const values = parseOptions([option])[0]?.values ?? []
            return (
              <div key={option.key} className="flex flex-col gap-3 rounded-md bg-ui-bg-base p-3 shadow-elevation-card-rest">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Input
                    aria-label={`Option ${n} name`}
                    placeholder="Name, for example Size"
                    value={option.name}
                    maxLength={40}
                    onChange={(event) => setOption(option.key, { name: event.target.value })}
                  />
                  <Input
                    aria-label={`Option ${n} values, separated by commas`}
                    placeholder="Values, for example S, M, L"
                    value={option.values}
                    onChange={(event) => setOption(option.key, { values: event.target.value })}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {values.length > 0 ? `Values: ${values.join(" | ")}` : "No values yet"}
                  </Text>
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    aria-label={`Remove option ${n}`}
                    onClick={() => patch({ options: form.options.filter((row) => row.key !== option.key) })}
                  >
                    Remove option
                  </Button>
                </div>
              </div>
            )
          })}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={form.options.length >= MAX_OPTIONS}
              onClick={() => patch({ options: [...form.options, { key: newKey(), name: "", values: "" }] })}
            >
              Add option
            </Button>
            <Button type="button" variant="secondary" onClick={generateVariants}>
              Generate variants
            </Button>
          </div>
          {generateNote && (
            <Text size="small" className="text-ui-fg-error" role="alert">
              {generateNote}
            </Text>
          )}
          {errorsUnder(errors, "options").map((message) => (
            <p key={message} className="txt-small text-ui-fg-error" data-field-error="true">
              {message}
            </p>
          ))}
          {err("variants") && (
            <p className="txt-small text-ui-fg-error" data-field-error="true" data-testid="error-variants">
              {err("variants")}
            </p>
          )}

          <VariantsTable rows={form.variants} onChange={(variants) => patch({ variants })} errorFor={err} />
        </section>

        <section className="flex flex-col gap-y-4" aria-labelledby="section-declarations">
          <Heading level="h2" id="section-declarations">
            Declarations
          </Heading>
          <DeclarationFields value={form.declaration} onChange={(declaration) => patch({ declaration })} errorFor={err} />
        </section>
      </fieldset>

      <div className="flex flex-wrap gap-3 border-t border-ui-border-base pt-4">
        {!readOnly && (
          <Button disabled={busy} onClick={onSaveClick}>
            {liveMode ? "Save change for review" : "Save draft"}
          </Button>
        )}
        {canSubmit && (
          <Button variant="secondary" disabled={busy || dirty} onClick={() => setConfirm("submit")}>
            Submit for review
          </Button>
        )}
        {canWithdraw && (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm("withdraw")}>
            Withdraw
          </Button>
        )}
      </div>

      <ConfirmPrompt
        open={confirm === "save"}
        title="Send this change for review?"
        description={LIVE_EDIT_CONFIRM}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void doSave()}
      />
      <ConfirmPrompt
        open={confirm === "submit"}
        title="Submit for review?"
        description="The store team reviews this product before it goes on sale. You cannot change it while it is in review."
        onCancel={() => setConfirm(null)}
        onConfirm={() => void afterAction(() => submit.mutateAsync(id as string))}
      />
      <ConfirmPrompt
        open={confirm === "withdraw"}
        title="Withdraw this product?"
        description={WITHDRAW_CONFIRM}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void afterAction(() => withdraw.mutateAsync(id as string))}
      />
      <ConfirmPrompt
        open={confirm === "discard"}
        title="Discard the pending change?"
        description="The live version is not affected."
        onCancel={() => setConfirm(null)}
        onConfirm={() => void afterAction(() => discard.mutateAsync(id as string))}
      />
    </div>
  )
}
