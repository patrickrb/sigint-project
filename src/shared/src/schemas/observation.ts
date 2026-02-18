import { z } from "zod";

export const observationSchema = z.object({
  observedAt: z.string().datetime().or(z.date()),
  protocol: z.string().min(1).max(100),
  frequencyHz: z.number().int().positive().optional(),
  rssi: z.number().optional(),
  snr: z.number().optional(),
  noise: z.number().optional(),
  modulation: z.string().max(20).optional(),
  signature: z.string().optional(),
  fields: z.record(z.unknown()),
  raw: z.string().optional(),
});

export const observationBatchSchema = z.object({
  observations: z.array(observationSchema).min(1).max(500),
});

export const observationQuerySchema = z.object({
  senderId: z.string().optional(),
  classification: z.enum(["KNOWN", "UNKNOWN", "PENDING"]).optional(),
  protocol: z.string().optional(),
  signature: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ObservationInput = z.infer<typeof observationSchema>;
export type ObservationBatchInput = z.infer<typeof observationBatchSchema>;
export type ObservationQuery = z.infer<typeof observationQuerySchema>;
