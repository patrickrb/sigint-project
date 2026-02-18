import { z } from "zod";

export const createWhitelistSchema = z.object({
  signature: z.string().min(1),
  label: z.string().min(1).max(200),
  protocol: z.string().optional(),
  notes: z.string().optional(),
});

export const whitelistQuerySchema = z.object({
  protocol: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateWhitelistInput = z.infer<typeof createWhitelistSchema>;
export type WhitelistQuery = z.infer<typeof whitelistQuerySchema>;
