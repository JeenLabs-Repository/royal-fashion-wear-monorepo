import { Alert, Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorState, LoadingState, NoAccessState } from "../../../lib/page-states";
import {
  type ReviewContent,
  type ReviewDetail,
  STATE_LABELS,
  describeError,
  useApprove,
  useCategories,
  useMyPermissions,
  useRejectOrRequest,
  useReview,
} from "../../../lib/product-reviews";
import { ApprovalPanel, type ApprovalForm } from "../components/ApprovalPanel";
import { ContentEditor } from "../components/ContentEditor";
import { DiffView } from "../components/DiffView";
import { ReasonDialog } from "../components/ReasonDialog";

const STALE_TEXT =
  "This item changed after you opened it. Reload to see the latest version, then check the list again.";
const DECLARED_WARNING =
  "Customers will see each product's declaration as the vendor entered it. This can reveal the vendor. Check the name and address before approving.";

const emptyForm = (): ApprovalForm => ({ checks: {}, prices: {}, categoryId: "", gstClass: "", hsn: "" });

const seedForm = (review: ReviewDetail, previous: ApprovalForm): ApprovalForm => {
  const prices: Record<string, string> = {};
  for (const variant of review.content.variants) {
    const live = review.live_prices.find((row) => row.vendor_sku === variant.vendor_sku);
    prices[variant.vendor_sku] = previous.prices[variant.vendor_sku] ?? live?.selling_price ?? "";
  }
  const proposedGst = review.content.proposed_gst_class;
  return {
    checks: {},
    prices,
    categoryId: previous.categoryId || review.content.proposed_category_id || "",
    gstClass: previous.gstClass || (proposedGst && proposedGst !== "not_sure" ? proposedGst : ""),
    hsn: previous.hsn || review.content.proposed_hsn || "",
  };
};

const Field = ({ label, value }: { label: string; value: string | number | null }) => (
  <div>
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small" leading="compact" className="whitespace-pre-wrap break-words">
      {value === null || value === "" ? "Empty" : value}
    </Text>
  </div>
);

const ContentColumn = ({ heading, content }: { heading: string; content: ReviewContent }) => (
  <Container className="flex flex-col gap-y-4 px-6 py-4" data-testid={`column-${heading}`}>
    <Heading level="h2">{heading}</Heading>
    <Field label="Title" value={content.title} />
    <Field label="Description" value={content.description} />

    <div>
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        Images
      </Text>
      <ol className="mt-1 flex flex-wrap gap-3">
        {content.images.map((image, index) => (
          <li key={image.upload_id}>
            {image.url ? (
              <a href={image.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={image.url}
                  alt={`Image ${index + 1}`}
                  referrerPolicy="no-referrer"
                  className="size-20 rounded border object-cover"
                />
                <span className="sr-only">Open image {index + 1} in a new tab</span>
              </a>
            ) : (
              <Text size="small" leading="compact">
                Image {index + 1} has no preview
              </Text>
            )}
            <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
              {index + 1}
            </Text>
          </li>
        ))}
      </ol>
    </div>

    {content.options.length > 0 ? (
      <Field
        label="Options"
        value={content.options.map((o) => `${o.title}: ${o.values.map((v) => v.value).join(", ")}`).join("\n")}
      />
    ) : null}

    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-ui-fg-subtle">
            <th className="pr-3 font-normal">Vendor SKU</th>
            <th className="pr-3 font-normal">Payout</th>
            <th className="pr-3 font-normal">MRP</th>
            <th className="pr-3 font-normal">Net quantity</th>
            <th className="pr-3 font-normal">Weight and size</th>
          </tr>
        </thead>
        <tbody>
          {content.variants.map((variant) => (
            <tr key={variant.vendor_sku}>
              <td className="pr-3">{variant.vendor_sku}</td>
              <td className="pr-3">{variant.payout_price ?? ""}</td>
              <td className="pr-3">{variant.mrp ?? ""}</td>
              <td className="pr-3">
                {variant.net_quantity_value ?? ""} {variant.net_quantity_unit ?? ""}
              </td>
              <td className="pr-3">
                {variant.weight_g ?? "?"} g, {variant.length_mm ?? "?"} x {variant.width_mm ?? "?"} x{" "}
                {variant.height_mm ?? "?"} mm
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Container>
);

const ProductReviewDetailPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, error, isLoading, isError, refetch } = useReview(id);
  const categories = useCategories();
  const permissions = useMyPermissions();
  const approve = useApprove(id);
  const decide = useRejectOrRequest(id);

  const [form, setForm] = useState<ApprovalForm>(emptyForm);
  const [stale, setStale] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reject" | "request" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const seededFor = useRef<string | null>(null);

  const review = data?.review;

  // Seed once per submission, and untick the checklist whenever the content hash changes.
  useEffect(() => {
    if (!review) {
      return;
    }
    setForm((previous) =>
      seededFor.current === review.id ? { ...previous, checks: {} } : seedForm(review, previous)
    );
    seededFor.current = review.id;
  }, [review?.id, review?.content_hash]);

  const failure = isError ? describeError(error) : null;
  if (failure?.forbidden) {
    return <NoAccessState message="You do not have access to product reviews." />;
  }
  if (failure) {
    return <ErrorState message={failure.message} onRetry={() => refetch()} />;
  }
  if (isLoading || !review) {
    return <LoadingState label="Loading product review" />;
  }

  const canReview = permissions.can("catalog:review");
  const canEdit = permissions.can("catalog:edit");

  const markStale = () => {
    setStale(true);
    setForm((previous) => ({ ...previous, checks: {} }));
  };

  const reload = async () => {
    await refetch();
    setStale(false);
    setServerError(null);
  };

  const handleFailure = (cause: unknown, target: "panel" | "dialog") => {
    const result = describeError(cause);
    if (result.stale) {
      setDialog(null);
      markStale();
    } else if (target === "dialog") {
      setDialogError(result.message);
    } else {
      setServerError(result.message);
    }
  };

  const onApprove = () => {
    setServerError(null);
    approve.mutate(
      {
        content_hash: review.content_hash,
        checklist: Object.fromEntries(review.checklist.map((item) => [item.key, true as const])),
        gst_class: form.gstClass,
        hsn: form.hsn.trim(),
        category_id: form.categoryId,
        prices: review.content.variants.map((variant) => ({
          vendor_sku: variant.vendor_sku,
          selling_price: (form.prices[variant.vendor_sku] ?? "").trim(),
        })),
      },
      {
        onSuccess: () => {
          toast.success("Product approved");
          navigate("/product-reviews");
        },
        onError: (cause) => handleFailure(cause, "panel"),
      }
    );
  };

  const onReason = (reason: string) => {
    if (!dialog) {
      return;
    }
    setDialogError(null);
    decide.mutate(
      { kind: dialog, content_hash: review.content_hash, reason },
      {
        onSuccess: () => {
          toast.success(dialog === "reject" ? "Product rejected" : "Changes requested");
          setDialog(null);
          navigate("/product-reviews");
        },
        onError: (cause) => handleFailure(cause, "dialog"),
      }
    );
  };

  return (
    <div className="flex flex-col gap-y-3">
      <Link to="/product-reviews" className="text-ui-fg-interactive text-sm">
        Back to product reviews
      </Link>

      <Container className="flex flex-wrap items-center gap-3 px-6 py-4">
        <Heading level="h1" data-testid="review-title">
          {review.content.title}
        </Heading>
        <Badge color="grey">{STATE_LABELS[review.state] ?? review.state}</Badge>
        {review.is_live ? <Badge color="blue">Live edit</Badge> : null}
        {review.reason ? (
          <Text size="small" leading="compact" className="w-full text-ui-fg-subtle">
            Reason given: {review.reason}
          </Text>
        ) : null}
      </Container>

      {stale ? (
        <Alert variant="warning" data-testid="stale-prompt">
          <div className="flex items-center justify-between gap-x-3">
            <span>{STALE_TEXT}</span>
            <Button size="small" variant="secondary" onClick={reload}>
              Reload
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className={review.live_content ? "grid grid-cols-1 gap-3 xl:grid-cols-2" : "grid grid-cols-1 gap-3"}>
        <ContentColumn heading="Vendor submission" content={review.content} />
        {review.live_content ? <ContentColumn heading="Live version" content={review.live_content} /> : null}
      </div>

      {review.is_live ? <DiffView diff={review.diff} /> : null}

      <Container className="flex flex-col gap-y-3 px-6 py-4" data-testid="declarations">
        <Heading level="h2">Declarations</Heading>
        {review.display_mode === "product_declared" ? (
          <Alert variant="warning" data-testid="display-mode-warning">
            {DECLARED_WARNING}
          </Alert>
        ) : (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Declaration display mode: {review.display_mode}
          </Text>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Generic name" value={review.content.declaration.generic_name} />
          <Field label="Country of origin" value={review.content.declaration.country_of_origin} />
          <Field label="Packed or marketed by" value={review.content.declaration.packed_by_name} />
          <Field label="Address" value={review.content.declaration.packed_by_address} />
        </div>
      </Container>

      {canEdit && review.state === "submitted" ? (
        <ContentEditor review={review} onStale={markStale} />
      ) : null}

      <ApprovalPanel
        review={review}
        form={form}
        categories={categories.data ?? []}
        canReview={canReview}
        pending={approve.isPending}
        serverError={serverError}
        onChange={setForm}
        onApprove={onApprove}
        onRequestChanges={() => setDialog("request")}
        onReject={() => setDialog("reject")}
      />

      <ReasonDialog
        open={dialog !== null}
        title={dialog === "reject" ? "Reject this product" : "Request changes"}
        confirmLabel={dialog === "reject" ? "Reject product" : "Send request"}
        pending={decide.isPending}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onConfirm={onReason}
      />
    </div>
  );
};

export default ProductReviewDetailPage;
