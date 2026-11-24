import type { ReactElement } from "react";
import BreakGlassReviewReminderEmail, {
  type BreakGlassReviewReminderProps,
} from "../break-glass-review-reminder";
import BreakGlassUsedEmail, { type BreakGlassUsedProps } from "../break-glass-used";
import StaffAlertEmail, { type StaffAlertProps } from "../staff-alert";
import { safeHttpUrl } from "./safe-url";

// Later work adds entries here. Every template declares its own props type and
// the sender accepts only that type: there is no free-form props escape hatch.
// That is how a later audit can prove what each email is able to contain.
export type EmailTemplates = {
  "staff-alert": StaffAlertProps;
  "break-glass-used": BreakGlassUsedProps;
  "break-glass-review-reminder": BreakGlassReviewReminderProps;
};

export type TemplateEntry<P> = {
  Component: (props: P) => ReactElement;
  subject: (props: P) => string;
  text: (props: P) => string;
};

export const EMAIL_TEMPLATES: { [K in keyof EmailTemplates]: TemplateEntry<EmailTemplates[K]> } = {
  "staff-alert": {
    Component: StaffAlertEmail,
    subject: (props) => props.subject,
    text: (props) => {
      const href = safeHttpUrl(props.link?.url);
      return [
        props.heading,
        ...props.lines,
        props.link && href ? `${props.link.label}: ${href}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  },
  "break-glass-used": {
    Component: BreakGlassUsedEmail,
    subject: (props) => `Break-glass account used at ${props.whenIst}`,
    text: (props) =>
      [
        "The break-glass account was used.",
        `When: ${props.whenIst} IST (${props.whenUtc} UTC)`,
        `From address: ${props.ip}`,
        props.forwardedFor ? `Forwarded for: ${props.forwardedFor}` : "",
        `First request: ${props.method} ${props.route}`,
        "Next: review the audit log, close the review in Admin under Staff, and rotate the break-glass credentials.",
        safeHttpUrl(props.reviewUrl) ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "break-glass-review-reminder": {
    Component: BreakGlassReviewReminderEmail,
    subject: (props) =>
      `Break-glass review still open after ${props.hoursOpen} hours`,
    text: (props) =>
      [
        `The break-glass review opened at ${props.openedAtIst} IST has been open for ${props.hoursOpen} hours.`,
        "Close it in Admin under Staff after you have checked the audit log and rotated the credentials.",
        safeHttpUrl(props.reviewUrl) ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
  },
};
