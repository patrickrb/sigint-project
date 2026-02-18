import { Router, Request, Response } from "express";
import { ruleQuerySchema, updateRuleSchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

router.get("/api/rules", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = ruleQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { type, enabled, limit, offset } = parsed.data;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (enabled !== undefined) where.enabled = enabled;

    const [rules, total] = await Promise.all([
      prisma.rule.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.rule.count({ where }),
    ]);

    res.json({ rules, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/rules/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = updateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.rule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
    if (parsed.data.config !== undefined) data.config = parsed.data.config as object;

    const rule = await prisma.rule.update({
      where: { id },
      data,
    });

    res.json({ rule });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
