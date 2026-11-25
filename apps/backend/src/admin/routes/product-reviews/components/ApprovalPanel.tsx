import {
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Tooltip,
} from "@medusajs/ui";
import {
  type CategoryOption,
  GST_CLASSES,
  type ReviewDetail,
  isValidHsn,
  priceProblem,
} from "../../../lib/product-reviews";

export type ApprovalForm = {
  checks: Record<string, boolean>;
  prices: Record<string, string>;
  categoryId: string;
  gstClass: string;
  hsn: string;
};

type ApprovalPanelProps = {
  review: ReviewDetail;
  form: ApprovalForm;
  categories: CategoryOption[];
  canReview: boolean;
  pending: boolean;
  serverError: string | null;
  onChange: (next: ApprovalForm) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReject: () => void;
};

/** True when every rule the server checks is already met on the page. */
export const approvalReady = (review: ReviewDetail, form: ApprovalForm): boolean =>
  review.state === "submitted" &&
  review.checklist.length > 0 &&
  review.checklist.every((item) => form.checks[item.key] === true) &&
  review.content.variants.every(
    (variant) => priceProblem(form.prices[variant.vendor_sku] ?? "", variant.mrp) === null
  ) &&
  form.categoryId !== "" &&
  (GST_CLASSES as readonly string[]).includes(form.gstClass) &&
  isValidHsn(form.hsn);

export const ApprovalPanel = ({
  review,
  form,
  categories,
  canReview,
  pending,
  serverError,
  onChange,
  onApprove,
  onRequestChanges,
  onReject,
}: ApprovalPanelProps) => {
  const ready = approvalReady(review, form);
  const decided = review.state !== "submitted";
  const hsnProblem = form.hsn !== "" && !isValidHsn(form.hsn);

  const setPrice = (sku: string, value: string) =>
    onChange({ ...form, prices: { ...form.prices, [sku]: value } });

  const deny = canReview ? undefined : "You need permission to decide on products.";

  const actionButton = (
    testId: string,
    label: string,
    props: {
      variant?: "primary" | "secondary" | "danger";
      disabled: boolean;
      isLoading?: boolean;
      onClick: () => void;
    }
  ) => {
    const button = (
      <Button
        data-testid={testId}
        variant={props.variant}
        disabled={props.disabled}
        isLoading={props.isLoading}
        onClick={props.onClick}
      >
        {label}
      </Button>
    );
    if (!deny) {
      return button;
    }
    return (
      <Tooltip content={deny}>
        <span>{button}</span>
      </Tooltip>
    );
  };

  return (
    <Container className="flex flex-col gap-y-6 px-6 py-4" data-testid="approval-panel">
      <Heading level="h2">Pricing and classification</Heading>

      <div className="flex flex-col gap-y-3">
        {review.content.variants.map((variant) => {
          const value = form.prices[variant.vendor_sku] ?? "";
          const problem = value === "" ? null : priceProblem(value, variant.mrp);
          const rowId = `price-${variant.vendor_sku}`;
          const mentioned = serverError !== null && serverError.includes(variant.vendor_sku);
          return (
            <div
              key={variant.vendor_sku}
              className="grid grid-cols-1 items-start gap-3 md:grid-cols-4"
              data-testid="price-row"
            >
              <div>
                <Text size="small" leading="compact" weight="plus">
                  {variant.vendor_sku}
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  {variant.option_values.map((item) => `${item.option}: ${item.value}`).join(", ")}
                </Text>
              </div>
              <div>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Payout price
                </Text>
                <Text size="small" leading="compact">
                  {variant.payout_price ?? "Empty"}
                </Text>
              </div>
              <div>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  MRP
                </Text>
                <Text size="small" leading="compact">
                  {variant.mrp ?? "Not given"}
                </Text>
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor={rowId}>Selling price (INR)</Label>
                <Input
                  id={rowId}
                  data-testid={rowId}
                  inputMode="decimal"
                  value={value}
                  disabled={decided}
                  aria-invalid={problem !== null || mentioned}
                  onChange={(event) => setPrice(variant.vendor_sku, event.target.value)}
                />
                {problem || mentioned ? (
                  <Text size="small" leading="compact" className="text-ui-fg-error" role="alert">
                    {problem ?? serverError}
                  </Text>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="review-category">Category</Label>
          <Select
            value={form.categoryId}
            disabled={decided}
            onValueChange={(value) => onChange({ ...form, categoryId: value })}
          >
            <Select.Trigger id="review-category" data-testid="category-select">
              <Select.Value placeholder="Choose a category" />
            </Select.Trigger>
            <Select.Content>
              {categories.map((category) => (
                <Select.Item key={category.id} value={category.id}>
                  {category.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="review-gst">GST class</Label>
          <Select
            value={form.gstClass}
            disabled={decided}
            onValueChange={(value) => onChange({ ...form, gstClass: value })}
          >
            <Select.Trigger id="review-gst" data-testid="gst-select">
              <Select.Value placeholder="Choose a GST class" />
            </Select.Trigger>
            <Select.Content>
              {GST_CLASSES.map((item) => (
                <Select.Item key={item} value={item}>
                  {item}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="review-hsn">HSN</Label>
          <Input
            id="review-hsn"
            data-testid="hsn-input"
            inputMode="numeric"
            value={form.hsn}
            disabled={decided}
            aria-invalid={hsnProblem}
            onChange={(event) => onChange({ ...form, hsn: event.target.value })}
          />
          {hsnProblem ? (
            <Text size="small" leading="compact" className="text-ui-fg-error" role="alert">
              Use 4, 6 or 8 digits.
            </Text>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-y-2" data-testid="checklist">
        <Heading level="h3">Anonymity checklist</Heading>
        {review.checklist.map((item) => (
          <div key={item.key} className="flex items-start gap-x-2">
            <Checkbox
              id={`check-${item.key}`}
              data-testid={`check-${item.key}`}
              checked={form.checks[item.key] === true}
              disabled={decided}
              onCheckedChange={(value) =>
                onChange({ ...form, checks: { ...form.checks, [item.key]: value === true } })
              }
            />
            <Label htmlFor={`check-${item.key}`}>{item.label}</Label>
          </div>
        ))}
      </div>

      {serverError && !review.content.variants.some((v) => serverError.includes(v.vendor_sku)) ? (
        <Text size="small" leading="compact" className="text-ui-fg-error" role="alert">
          {serverError}
        </Text>
      ) : null}

      <div className="flex flex-wrap gap-x-2 gap-y-2">
        {actionButton("approve", "Approve", {
          disabled: !canReview || !ready || pending,
          isLoading: pending,
          onClick: onApprove,
        })}
        {actionButton("request-changes", "Request changes", {
          variant: "secondary",
          disabled: !canReview || decided || pending,
          onClick: onRequestChanges,
        })}
        {actionButton("reject", "Reject", {
          variant: "danger",
          disabled: !canReview || decided || pending,
          onClick: onReject,
        })}
      </div>
    </Container>
  );
};
