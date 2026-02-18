import { Router, Request, Response } from "express";
import { createWhitelistSchema, whitelistQuerySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

router.get("/api/whitelist", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = whitelistQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { protocol, limit, offset } = parsed.data;

    const where: Record<string, unknown> = {};
    if (protocol) where.protocol = protocol;

    const [entries, total] = await Promise.all([
      prisma.whitelistEntry.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.whitelistEntry.count({ where }),
    ]);

    res.json({ entries, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/whitelist", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = createWhitelistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { signature, label, protocol, notes } = parsed.data;

    const entry = await prisma.whitelistEntry.create({
      data: {
        signature,
        label,
        protocol: protocol ?? null,
        notes: notes ?? null,
        userId: req.user!.userId,
      },
    });

    // Update existing PENDING observations with this signature to KNOWN
    await prisma.observation.updateMany({
      where: { signature, classification: "PENDING" },
      data: { classification: "KNOWN" },
    });

    res.status(201).json({ entry });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/whitelist/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const entry = await prisma.whitelistEntry.findUnique({ where: { id } });
    if (!entry) {
      res.status(404).json({ error: "Whitelist entry not found" });
      return;
    }

    await prisma.whitelistEntry.delete({ where: { id } });

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
