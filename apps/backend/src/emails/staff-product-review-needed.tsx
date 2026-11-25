import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent to catalog approvers. Holds the product title, the kind of review and a link, nothing else. */
export type StaffProductReviewNeededProps = {
  product_title: string;
  is_live_edit: boolean;
  review_url: string;
};

export const staffProductReviewNeededSubject = (_props: StaffProductReviewNeededProps): string =>
  "A product needs review";

const sentence = (props: StaffProductReviewNeededProps): string =>
  props.is_live_edit
    ? `A change to the live product "${props.product_title}" is waiting for review.`
    : `The new product "${props.product_title}" is waiting for review.`;

export const staffProductReviewNeededText = (props: StaffProductReviewNeededProps): string =>
  [sentence(props), `Open the review: ${safeHttpUrl(props.review_url) ?? ""}`].join("\n\n");

export function StaffProductReviewNeededEmail(props: StaffProductReviewNeededProps) {
  const href = safeHttpUrl(props.review_url);

  return (
    <EmailLayout preview={staffProductReviewNeededSubject(props)}>
      <Heading style={s.heading}>A product needs review</Heading>
      <Text style={s.paragraph}>{sentence(props)}</Text>
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

export default StaffProductReviewNeededEmail;
