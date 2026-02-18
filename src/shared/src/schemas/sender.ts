import { z } from "zod";

export const createSenderSchema = z.object({
  name: z.string().min(1).max(200),
});

export const senderQuerySchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateSenderInput = z.infer<typeof createSenderSchema>;
export type SenderQuery = z.infer<typeof senderQuerySchema>;
