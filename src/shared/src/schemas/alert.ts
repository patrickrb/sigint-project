import { z } from "zod";

export const alertQuerySchema = z.object({
  ruleId: z.string().optional(),
  senderId: z.string().optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  acknowledged: z.coerce.boolean().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AlertQuery = z.infer<typeof alertQuerySchema>;
