import { z } from "zod";

export const createProtocolRuleSchema = z.object({
  pattern: z.string().min(1).max(200),
  classification: z.enum(["KNOWN", "UNKNOWN"]).default("KNOWN"),
  label: z.string().min(1).max(200),
});

export const protocolRuleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateProtocolRuleInput = z.infer<typeof createProtocolRuleSchema>;
export type ProtocolRuleQuery = z.infer<typeof protocolRuleQuerySchema>;
