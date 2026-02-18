import { z } from "zod";

export const unknownBurstConfigSchema = z.object({
  threshold: z.number().int().min(1),
  windowSeconds: z.number().int().min(1),
});

export const newDeviceConfigSchema = z.object({});

export const customConfigSchema = z.record(z.unknown());

export const ruleConfigSchema = z.union([
  unknownBurstConfigSchema,
  newDeviceConfigSchema,
  customConfigSchema,
]);

export const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  config: ruleConfigSchema.optional(),
});

export const ruleQuerySchema = z.object({
  type: z.enum(["UNKNOWN_BURST", "NEW_DEVICE", "CUSTOM"]).optional(),
  enabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type RuleQuery = z.infer<typeof ruleQuerySchema>;
