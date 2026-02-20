import { z } from "zod";

export const bleDeviceQuerySchema = z.object({
  deviceType: z.enum([
    "PHONE", "TRACKER", "BEACON", "IOT", "WEARABLE", "COMPUTER", "UNKNOWN",
  ]).optional(),
  classification: z.enum(["KNOWN", "UNKNOWN", "THREAT"]).optional(),
  trackerType: z.string().optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bleDeviceClassifySchema = z.object({
  classification: z.enum(["KNOWN", "UNKNOWN", "THREAT"]),
  displayName: z.string().max(200).optional(),
});

export type BleDeviceQuery = z.infer<typeof bleDeviceQuerySchema>;
export type BleDeviceClassifyInput = z.infer<typeof bleDeviceClassifySchema>;
