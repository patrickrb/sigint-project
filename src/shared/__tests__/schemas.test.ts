import { describe, it, expect } from "vitest";
import {
  observationSchema,
  observationBatchSchema,
  observationQuerySchema,
} from "../src/schemas/observation";
import * as senderSchemas from "../src/schemas/sender";
import * as whitelistSchemas from "../src/schemas/whitelist";
import * as ruleSchemas from "../src/schemas/rule";
import * as alertSchemas from "../src/schemas/alert";
import * as authSchemas from "../src/schemas/auth";

describe("observationSchema", () => {
  it("accepts valid observation", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      frequencyHz: 433920000,
      rssi: -45.5,
      fields: { device_id: "abc", channel: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("requires protocol", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      fields: { device_id: "abc" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "motion",
      fields: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts snr, noise, and modulation fields", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      fields: { device_id: "abc" },
      snr: 18.5,
      noise: -92.1,
      modulation: "ASK",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.snr).toBe(18.5);
      expect(result.data.noise).toBe(-92.1);
      expect(result.data.modulation).toBe("ASK");
    }
  });

  it("rejects non-numeric snr", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      fields: {},
      snr: "high",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric noise", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      fields: {},
      noise: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects modulation exceeding 20 characters", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      fields: {},
      modulation: "A".repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it("accepts modulation at exactly 20 characters", () => {
    const result = observationSchema.safeParse({
      observedAt: "2025-01-01T00:00:00.000Z",
      protocol: "temperature",
      fields: {},
      modulation: "A".repeat(20),
    });
    expect(result.success).toBe(true);
  });
});

describe("observationBatchSchema", () => {
  it("accepts valid batch", () => {
    const result = observationBatchSchema.safeParse({
      observations: [
        {
          observedAt: "2025-01-01T00:00:00.000Z",
          protocol: "temperature",
          fields: { value: 22.5 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty batch", () => {
    const result = observationBatchSchema.safeParse({ observations: [] });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts valid login", () => {
    const result = authSchemas.loginSchema.safeParse({
      email: "admin@local",
      password: "admin123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty email", () => {
    const result = authSchemas.loginSchema.safeParse({
      email: "",
      password: "admin123",
    });
    expect(result.success).toBe(false);
  });
});

describe("createSenderSchema", () => {
  it("accepts valid sender", () => {
    const result = senderSchemas.createSenderSchema.safeParse({ name: "My Receiver" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = senderSchemas.createSenderSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("createWhitelistSchema", () => {
  it("accepts valid entry", () => {
    const result = whitelistSchemas.createWhitelistSchema.safeParse({
      signature: "abc123",
      label: "Kitchen Sensor",
      protocol: "temperature",
    });
    expect(result.success).toBe(true);
  });

  it("requires signature and label", () => {
    const result = whitelistSchemas.createWhitelistSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("updateRuleSchema", () => {
  it("accepts partial update", () => {
    const result = ruleSchemas.updateRuleSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
  });

  it("accepts config update", () => {
    const result = ruleSchemas.updateRuleSchema.safeParse({
      config: { threshold: 5, windowSeconds: 30 },
    });
    expect(result.success).toBe(true);
  });
});

describe("alertQuerySchema", () => {
  it("accepts valid query", () => {
    const result = alertSchemas.alertQuerySchema.safeParse({
      severity: "WARNING",
      limit: "25",
    });
    expect(result.success).toBe(true);
  });

  it("uses defaults", () => {
    const result = alertSchemas.alertQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });
});
