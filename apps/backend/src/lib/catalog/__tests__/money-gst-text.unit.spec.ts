import { MedusaError } from "@medusajs/framework/utils";
import { GST_CLASSES, isValidHsn } from "../gst";
import { compareDecimals, parseRupees } from "../money";
import { normalizePlainText, stripTags } from "../text";

describe("GST", () => {
  it("lists exactly the five classes", () => {
    expect([...GST_CLASSES]).toEqual(["GST-0", "GST-5", "GST-18", "GST-40", "not_sure"]);
  });

  it("accepts HSN codes of 4, 6 and 8 digits", () => {
    for (const value of ["1234", "123456", "12345678"]) {
      expect(isValidHsn(value)).toBe(true);
    }
  });

  it("rejects every other HSN shape", () => {
    for (const value of ["123", "12345", "1234567", "123456789", "12a4", "", " 1234", "1234\n"]) {
      expect(isValidHsn(value)).toBe(false);
    }
  });
});

describe("parseRupees", () => {
  it("accepts amounts in range and returns the two-decimal string", () => {
    expect(parseRupees("199.99")).toBe("199.99");
    expect(parseRupees("0.01")).toBe("0.01");
    expect(parseRupees("999999.99")).toBe("999999.99");
    expect(parseRupees("12.5")).toBe("12.50");
    expect(parseRupees("12")).toBe("12.00");
    expect(typeof parseRupees("5")).toBe("string");
  });

  it.each(["1000000", "0", "0.00", "0.001", "-5", "1e3", " 12", "12 ", "12,50", "₹12", "", "12.", ".5"])(
    "rejects %p",
    (input) => {
      expect(() => parseRupees(input)).toThrow(MedusaError);
    }
  );

  it("rejects a number type so no float enters", () => {
    expect(() => parseRupees(199.99 as unknown as string)).toThrow(MedusaError);
  });
});

describe("compareDecimals", () => {
  it("compares without floats", () => {
    expect(compareDecimals("199.99", "200")).toBe(-1);
    expect(compareDecimals("200.00", "200")).toBe(0);
    expect(compareDecimals("250.01", "250")).toBe(1);
    expect(compareDecimals("0.10", "0.1")).toBe(0);
  });
});

describe("stripTags", () => {
  it("removes script bodies, tags and event-handler tags", () => {
    const result = stripTags(
      "<b>Soft</b> cotton<script>alert(1)</script> & more <img src=x onerror=y>"
    );
    expect(result).toBe("Soft cotton & more");
    expect(result).not.toMatch(/[<>]/);
    expect(result).not.toContain("alert");
  });

  it("removes style elements and an unclosed script element", () => {
    expect(stripTags("a<style>p{color:red}</style>b")).toBe("ab");
    expect(stripTags("keep<SCRIPT src=x>evil()")).toBe("keep");
  });

  it("leaves no angle bracket behind nested or broken tags", () => {
    for (const input of ["<scr<script>ipt>x</script>ipt>", "a < b > c", "<<b>>x", "<a href=\"x"]) {
      expect(stripTags(input)).not.toMatch(/[<>]/);
    }
  });

  it("keeps line breaks, collapses spaces and drops control characters", () => {
    expect(stripTags("line one\r\n\r\nline  two\t!\u0000\u0007")).toBe("line one\n\nline two !");
  });

  it("returns plain input unchanged", () => {
    expect(stripTags("Soft cotton\nthree lines")).toBe("Soft cotton\nthree lines");
  });
});

describe("normalizePlainText", () => {
  it("throws invalid_data when nothing is left after stripping", () => {
    expect(() => normalizePlainText("<b></b><script>x</script>", 100)).toThrow(MedusaError);
    expect(() => normalizePlainText("   ", 100)).toThrow(MedusaError);
  });

  it("throws when longer than the maximum and accepts exactly the maximum", () => {
    expect(() => normalizePlainText("a".repeat(11), 10)).toThrow(MedusaError);
    expect(normalizePlainText("a".repeat(10), 10)).toBe("a".repeat(10));
  });
});
