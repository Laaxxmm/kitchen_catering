import { describe, expect, it } from "vitest";
import {
  formatGPHiredItemCode,
  formatGPInhouseItemCode,
  formatGPItemCode,
} from "@/lib/sequences";

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

describe("F&B item codes", () => {
  it("zero-pads to three digits", () => {
    expect(formatGPInhouseItemCode(1)).toBe("GP-IN-001");
    expect(formatGPInhouseItemCode(151)).toBe("GP-IN-151");
    expect(formatGPHiredItemCode(1)).toBe("GP-HR-001");
    expect(formatGPHiredItemCode(42)).toBe("GP-HR-042");
  });

  it("grows past 999 instead of wrapping", () => {
    expect(formatGPInhouseItemCode(1000)).toBe("GP-IN-1000");
    expect(formatGPHiredItemCode(12345)).toBe("GP-HR-12345");
  });

  it("never collides with the kitchen counter or each other", () => {
    // The three catalogues number from 1 independently, so the same n comes
    // up in all three — the prefix is the only thing keeping them apart.
    const codes = Array.from({ length: 1200 }, (_, i) => i + 1).flatMap((n) => [
      formatGPItemCode(n),
      formatGPInhouseItemCode(n),
      formatGPHiredItemCode(n),
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
