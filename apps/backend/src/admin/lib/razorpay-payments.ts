import { errorMessage, isForbidden } from "./staff-api";

export const RAZORPAY_PROVIDER_ID = "pp_razorpay_razorpay";

export type RunView = {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  scanned_count: number;
  mismatch_count: number;
  truncated: boolean;
};

export type ItemView = {
  id: string;
  kind: string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  medusa_payment_id: string | null;
  payment_session_id: string | null;
  amount_paise: number;
  amount_inr: string;
  age_hours: number;
  resolved_at: string | null;
  resolved_note: string | null;
  refundable: boolean;
};

export type RefundView = {
  razorpay_refund_id: string;
  razorpay_payment_id: string;
  amount_paise: number;
  amount_inr: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type RefundResult = { razorpay_refund_id: string | null; status: string };

export const KIND_LABELS: Record<string, string> = {
  captured_no_order: "Paid, no order",
  order_not_captured: "Order, payment not captured",
  amount_mismatch: "Amount differs",
  refund_mismatch: "Refund differs",
};

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? "Other";

export const RUN_STATUS_COLORS: Record<string, "green" | "red" | "blue" | "grey"> = {
  completed: "green",
  failed: "red",
  running: "blue",
};

export const REFUND_STATUS_COLORS: Record<string, "green" | "red" | "grey"> = {
  processed: "green",
  failed: "red",
  requested: "grey",
  pending: "grey",
};

export const isOpenRefund = (status: string): boolean =>
  status === "requested" || status === "pending";

// Indian digit grouping (12,34,567.00) without floating point: the amount arrives as a decimal string.
export const formatInr = (value: string): string => {
  const [whole, fraction = "00"] = value.split(".");
  const digits = whole.replace(/\D/g, "") || "0";
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  return `₹${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
};

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatIst = (iso: string | null): string => {
  if (!iso) {
    return "Not yet";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not yet" : `${IST.format(date)} IST`;
};

export const describeAge = (hours: number): string => {
  if (hours < 1) {
    return "Under 1 hour";
  }
  if (hours < 48) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${Math.floor(hours / 24)} days`;
};

export type Failure = { forbidden: boolean; message: string };

export const failureOf = (error: unknown): Failure => ({
  forbidden: isForbidden(error),
  message: errorMessage(error),
});
