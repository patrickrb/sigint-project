import { describe, it, expect } from "vitest";
import { computeSignature } from "../src/utils/signature";

describe("computeSignature", () => {
  it("produces consistent hash for same inputs", () => {
    const sig1 = computeSignature("temperature", { device_id: "abc", channel: "1" });
    const sig2 = computeSignature("temperature", { device_id: "abc", channel: "1" });
    expect(sig1).toBe(sig2);
  });

  it("produces different hash for different protocols", () => {
    const sig1 = computeSignature("temperature", { device_id: "abc" });
    const sig2 = computeSignature("humidity", { device_id: "abc" });
    expect(sig1).not.toBe(sig2);
  });

  it("produces different hash for different fields", () => {
    const sig1 = computeSignature("temperature", { device_id: "abc" });
    const sig2 = computeSignature("temperature", { device_id: "def" });
    expect(sig1).not.toBe(sig2);
  });

  it("ignores field order", () => {
    const sig1 = computeSignature("temp", { a: "1", b: "2", c: "3" });
    const sig2 = computeSignature("temp", { c: "3", a: "1", b: "2" });
    expect(sig1).toBe(sig2);
  });

  it("ignores null/undefined values", () => {
    const sig1 = computeSignature("temp", { a: "1" });
    const sig2 = computeSignature("temp", { a: "1", b: null, c: undefined });
    expect(sig1).toBe(sig2);
  });

  it("returns hex string of expected length", () => {
    const sig = computeSignature("test", { id: "123" });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
