import { Router, Request, Response } from "express";
import { observationQuerySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

router.get("/api/observations", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = observationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { senderId, classification, protocol, signature, since, until, limit, offset } =
      parsed.data;

    const where: Record<string, unknown> = {};
    if (senderId) where.senderId = senderId;
    if (classification) where.classification = classification;
    if (protocol) where.protocol = protocol;
    if (signature) where.signature = signature;
    if (since || until) {
      where.receivedAt = {
        ...(since ? { gte: new Date(since) } : {}),
        ...(until ? { lte: new Date(until) } : {}),
      };
    }

    const [observations, total] = await Promise.all([
      prisma.observation.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { receivedAt: "desc" },
        include: {
          sender: { select: { id: true, name: true } },
        },
      }),
      prisma.observation.count({ where }),
    ]);

    res.json({ observations, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/observations/stats", authenticateUser, async (req: Request, res: Response) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      totalObservations,
      knownCount,
      unknownCount,
      pendingCount,
      activeSenders,
      recentObservations,
    ] = await Promise.all([
      prisma.observation.count(),
      prisma.observation.count({ where: { classification: "KNOWN" } }),
      prisma.observation.count({ where: { classification: "UNKNOWN" } }),
      prisma.observation.count({ where: { classification: "PENDING" } }),
      prisma.sender.count({
        where: { lastSeenAt: { gte: fiveMinutesAgo }, status: "ACTIVE" },
      }),
      prisma.observation.count({
        where: { receivedAt: { gte: oneHourAgo } },
      }),
    ]);

    const observationsPerMinute = Math.round((recentObservations / 60) * 100) / 100;

    res.json({
      totalObservations,
      knownCount,
      unknownCount,
      pendingCount,
      activeSenders,
      observationsPerMinute,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
