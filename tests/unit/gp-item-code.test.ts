import { describe, expect, it } from "vitest";
import { formatGPItemCode } from "@/lib/sequences";

describe("formatGPItemCode", () => {
  it("zero-pads to three digits", () => {
    expect(formatGPItemCode(1)).toBe("GP-001");
    expect(formatGPItemCode(45)).toBe("GP-045");
    expect(formatGPItemCode(999)).toBe("GP-999");
  });

  it("grows past 999 instead of wrapping", () => {
    expect(formatGPItemCode(1000)).toBe("GP-1000");
    expect(formatGPItemCode(12345)).toBe("GP-12345");
  });

  it("never repeats a code for different numbers", () => {
    const codes = Array.from({ length: 1200 }, (_, i) => formatGPItemCode(i + 1));
    expect(new Set(codes).size).toBe(codes.length);
  });
});
