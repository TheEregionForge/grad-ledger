import { describe, expect, it } from "vitest";
import { normalizeForComparison, stripHonorific, toCsvCell } from "../../src/shared/normalization";
import { looksLikePersonName, normalizePersonName } from "../../src/extraction/validators";

describe("normalization helpers", () => {
  it("normalizes comparison text", () => {
    expect(normalizeForComparison("  Jane   Smith  ")).toBe("jane smith");
  });

  it("strips common academic honorifics", () => {
    expect(stripHonorific("Prof. Dr. Jane Smith").name).toBe("Jane Smith");
    expect(stripHonorific("Dr Jane Smith").name).toBe("Jane Smith");
  });

  it("normalizes comma-separated names", () => {
    expect(normalizePersonName("Smith, Jane A.")).toBe("Jane A. Smith");
  });

  it("rejects navigation-like names", () => {
    expect(looksLikePersonName("Department of Computer Science")).toBe(false);
    expect(looksLikePersonName("Jane A. Smith")).toBe(true);
  });

  it("escapes CSV cells", () => {
    expect(toCsvCell('Jane "J." Smith')).toBe('"Jane ""J."" Smith"');
  });
});
