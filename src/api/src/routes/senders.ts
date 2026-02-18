import { Router, Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import { createSenderSchema, senderQuerySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";
import { encryptToken, decryptToken } from "../services/crypto";

const router = Router();

router.post("/api/senders", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = createSenderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { name } = parsed.data;
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const encryptedToken = encryptToken(token);

    const sender = await prisma.sender.create({
      data: {
        name,
        tokenHash,
        encryptedToken,
        userId: req.user!.userId,
      },
    });

    res.status(201).json({
      sender: {
        id: sender.id,
        name: sender.name,
        status: sender.status,
        lastSeenAt: sender.lastSeenAt,
      },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/senders", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = senderQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { status, limit, offset } = parsed.data;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [senders, total] = await Promise.all([
      prisma.sender.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          lastSeenAt: true,
          userId: true,
          _count: { select: { observations: true } },
        },
      }),
      prisma.sender.count({ where }),
    ]);

    res.json({ senders, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/senders/:id/token", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const sender = await prisma.sender.findUnique({ where: { id } });
    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }

    if (sender.userId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized to view this sender's token" });
      return;
    }

    if (!sender.encryptedToken) {
      res.status(422).json({ error: "Token not available — this sender was created before token recovery was supported" });
      return;
    }

    const token = decryptToken(sender.encryptedToken);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/senders/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const sender = await prisma.sender.findUnique({ where: { id } });
    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }

    if (sender.userId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized to delete this sender" });
      return;
    }

    if (sender.status !== "REVOKED") {
      res.status(400).json({ error: "Only revoked senders can be deleted" });
      return;
    }

    await prisma.sender.delete({ where: { id } });

    res.json({ message: "Sender deleted" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/senders/:id/revoke", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const sender = await prisma.sender.findUnique({ where: { id } });
    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }

    if (sender.userId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized to revoke this sender" });
      return;
    }

    const updated = await prisma.sender.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    res.json({ sender: updated });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
