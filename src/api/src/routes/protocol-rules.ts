import { Router, Request, Response } from "express";
import { createProtocolRuleSchema, protocolRuleQuerySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

router.get("/api/protocol-rules", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = protocolRuleQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { limit, offset } = parsed.data;

    const [rules, total] = await Promise.all([
      prisma.protocolRule.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.protocolRule.count(),
    ]);

    res.json({ rules, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/protocol-rules", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = createProtocolRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const rule = await prisma.protocolRule.create({
      data: parsed.data,
    });

    res.status(201).json({ rule });
  } catch (err: any) {
    if (err?.code === "P2002") {
      res.status(409).json({ error: "A rule with this pattern already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/protocol-rules/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const rule = await prisma.protocolRule.findUnique({ where: { id } });
    if (!rule) {
      res.status(404).json({ error: "Protocol rule not found" });
      return;
    }

    await prisma.protocolRule.delete({ where: { id } });

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
