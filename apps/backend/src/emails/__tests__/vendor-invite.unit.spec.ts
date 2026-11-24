import { render } from "@react-email/render";
import { createElement } from "react";
import { EMAIL_TEMPLATES } from "../lib/templates";
import VendorInviteEmail, {
  vendorInviteSubject,
  vendorInviteText,
  type VendorInviteProps,
} from "../vendor-invite";

const props: VendorInviteProps = {
  store_name: "Test Store",
  contact_name: "Asha",
  accept_url: "https://backend.example.test/vendor-portal/accept-invite#token=abc123",
  expires_label: "Friday 27 November 2026, 18:30 IST",
  expiry_hours: 72,
};

const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("vendor invite email", () => {
  test("the subject names the store", () => {
    expect(vendorInviteSubject(props)).toBe("Your invitation to Test Store");
  });

  test("the html holds the store name, the link and the expiry", async () => {
    const html = await render(createElement(VendorInviteEmail, props));
    const text = visibleText(html);
    expect(html).toContain("Test Store");
    expect(html).toContain("accept-invite#token=abc123");
    expect(html).toContain(props.expires_label);
    // React Email may insert comment nodes between adjacent text nodes.
    expect(text).toMatch(/\b72\s+hours\b/);
  });

  test("the accept link is the only link", async () => {
    const html = await render(createElement(VendorInviteEmail, props));
    expect(html.match(/href="/g)).toHaveLength(1);
  });

  test("the text part holds the link once and the expiry", () => {
    const text = vendorInviteText(props);
    expect(text.split(props.accept_url)).toHaveLength(2);
    expect(text).toContain(props.expires_label);
  });

  test("no order, product, customer or price wording appears", async () => {
    const html = await render(createElement(VendorInviteEmail, props));
    const words = /\b(orders?|products?|customers?|prices?)\b/i;
    expect(visibleText(html)).not.toMatch(words);
    expect(vendorInviteText(props)).not.toMatch(words);
  });

  test("a link that is not http or https is dropped from both parts", async () => {
    const unsafe = { ...props, accept_url: "javascript:alert(1)" };
    const html = await render(createElement(VendorInviteEmail, unsafe));
    expect(html).not.toContain("javascript:");
    expect(vendorInviteText(unsafe)).not.toContain("javascript:");
  });

  test("is registered in the template registry", () => {
    const entry = EMAIL_TEMPLATES["vendor-invite"];
    expect(entry.subject(props)).toBe("Your invitation to Test Store");
    expect(entry.text(props)).toContain(props.accept_url);
  });
});
