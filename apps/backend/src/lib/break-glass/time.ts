// Time formatting for the alert emails. The owner reads these in India.

const IST = "Asia/Kolkata";

/** For example "10 Jan 2026, 9:00:00 am IST". */
export function formatIst(date: Date): string {
  const text = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: IST,
  }).format(date);
  return `${text} IST`;
}

/** The calendar date in India as YYYY-MM-DD. */
export function istDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
