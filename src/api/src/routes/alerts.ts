import { Router, Request, Response } from "express";
import { alertQuerySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

router.get("/api/alerts", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = alertQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { ruleId, senderId, severity, acknowledged, since, limit, offset } = parsed.data;

    const where: Record<string, unknown> = {};
    if (ruleId) where.ruleId = ruleId;
    if (senderId) where.senderId = senderId;
    if (severity) where.severity = severity;
    if (acknowledged !== undefined) {
      where.acknowledgedAt = acknowledged ? { not: null } : null;
    }
    if (since) {
      where.createdAt = { gte: new Date(since) };
    }

    const [alerts, total] = await Promise.all([
      prisma.alertEvent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: {
          rule: { select: { id: true, name: true, type: true } },
          sender: { select: { id: true, name: true } },
        },
      }),
      prisma.alertEvent.count({ where }),
    ]);

    res.json({ alerts, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/alerts/:id/ack", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.alertEvent.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    const alert = await prisma.alertEvent.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });

    res.json({ alert });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
