import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent to the alert recipients when the break-glass account is used. No secrets. */
export type BreakGlassUsedProps = {
  whenUtc: string;
  whenIst: string;
  ip: string;
  forwardedFor?: string;
  method: string;
  route: string;
  reviewUrl: string;
};

export function BreakGlassUsedEmail({
  whenUtc,
  whenIst,
  ip,
  forwardedFor,
  method,
  route,
  reviewUrl,
}: BreakGlassUsedProps) {
  const href = safeHttpUrl(reviewUrl);

  return (
    <EmailLayout preview={`Break-glass account used at ${whenIst}`}>
      <Heading style={s.heading}>The break-glass account was used</Heading>

      <Text style={s.paragraph}>
        The emergency admin account signed in and sent a request. If you did
        not expect this, treat it as a possible break-in.
      </Text>

      <Text style={s.paragraph}>When: {whenIst} IST ({whenUtc} UTC)</Text>
      <Text style={s.paragraph}>From address: {ip}</Text>
      {forwardedFor ? (
        <Text style={s.paragraph}>Forwarded for: {forwardedFor}</Text>
      ) : null}
      <Text style={s.paragraph}>
        First request: {method} {route}
      </Text>

      <Text style={s.paragraph}>
        What to do next: review the audit log for this account, close the
        review in Admin under Staff, and rotate the break-glass credentials.
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

export default BreakGlassUsedEmail;
