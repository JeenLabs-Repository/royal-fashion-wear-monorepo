import {
  Body,
  Container,
  Head,
  Preview,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import * as React from "react";
import {
  type EmailLocale,
  DEFAULT_EMAIL_LOCALE,
  getEmailTranslator,
  STORE_ADDRESS,
  STORE_EMAIL,
  STORE_NAME,
  STORE_PHONE,
} from "./i18n";
import * as s from "./lib/styles";

type EmailLayoutProps = {
  preview: string;
  children: React.ReactNode;
  locale?: EmailLocale;
};

export function EmailLayout({
  preview,
  children,
  locale = DEFAULT_EMAIL_LOCALE,
}: EmailLayoutProps) {
  const { t } = getEmailTranslator(locale);
  const contactLine = [STORE_ADDRESS, STORE_EMAIL, STORE_PHONE]
    .filter(Boolean)
    .join(" · ");

  // Native html: react-email's Html component hard-defaults dir="ltr", which
  // would leave a direction attribute after right-to-left support is removed.
  return (
    <html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.header}>
            <Text style={s.brand}>{STORE_NAME}</Text>
          </Section>

          <Section style={s.content}>{children}</Section>

          <Hr style={s.divider} />
          <Section style={s.footer}>
            <Text style={s.footerText}>
              {t("Layout.copyright", { year: new Date().getFullYear() })}
            </Text>
            {contactLine ? (
              <Text style={s.footerText}>{contactLine}</Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </html>
  );
}
