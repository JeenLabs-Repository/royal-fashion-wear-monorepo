import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent daily while a break-glass review has stayed open for more than a day. */
export type BreakGlassReviewReminderProps = {
  openedAtIst: string;
  hoursOpen: number;
  reviewUrl: string;
};

export function BreakGlassReviewReminderEmail({
  openedAtIst,
  hoursOpen,
  reviewUrl,
}: BreakGlassReviewReminderProps) {
  const href = safeHttpUrl(reviewUrl);

  return (
    <EmailLayout preview={`Break-glass review still open after ${hoursOpen} hours`}>
      <Heading style={s.heading}>A break-glass review is still open</Heading>

      <Text style={s.paragraph}>
        The break-glass account was used and the review opened at {openedAtIst}{" "}
        IST has been open for {hoursOpen} hours.
      </Text>

      <Text style={s.paragraph}>
        Close the review in Admin under Staff after you have checked the audit
        log and rotated the break-glass credentials.
      </Text>

      {href ? (
        <Section style={s.buttonSection}>
          <Button href={href} style={s.button}>
            Open the review
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

export default BreakGlassReviewReminderEmail;
