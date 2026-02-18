import { Router, Request, Response } from "express";
import {
  observationBatchSchema,
  computeSignature,
} from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateSender } from "../middleware/auth";
import sseManager from "../services/sse";

const router = Router();

router.post("/api/ingest", authenticateSender, async (req: Request, res: Response) => {
  try {
    const parsed = observationBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { observations } = parsed.data;
    const senderId = req.sender!.id;

    // Look up known signatures for classification
    const signatures = new Set<string>();
    const dataToInsert = observations.map((obs) => {
      const signature =
        obs.signature || computeSignature(obs.protocol, obs.fields as Record<string, unknown>);
      signatures.add(signature);
      return {
        senderId,
        observedAt: new Date(obs.observedAt as string),
        protocol: obs.protocol,
        frequencyHz: obs.frequencyHz ? BigInt(obs.frequencyHz) : null,
        rssi: obs.rssi ?? null,
        signature,
        fields: obs.fields as object,
        raw: obs.raw ?? null,
        classification: "PENDING" as const,
      };
    });

    // Only whitelisted signatures are KNOWN — everything else stays PENDING for worker classification
    const whitelisted = await prisma.whitelistEntry.findMany({
      where: { signature: { in: Array.from(signatures) } },
      select: { signature: true },
    });
    const whitelistedSet = new Set(whitelisted.map((w) => w.signature));

    const finalData = dataToInsert.map((d) => ({
      ...d,
      classification: whitelistedSet.has(d.signature) ? ("KNOWN" as const) : ("PENDING" as const),
    }));

    // Bulk insert
    const result = await prisma.observation.createMany({
      data: finalData,
    });

    // Query inserted observations with sender info for SSE broadcast
    const inserted = await prisma.observation.findMany({
      where: {
        senderId,
        receivedAt: { gte: new Date(Date.now() - 5000) },
        signature: { in: finalData.map((d) => d.signature) },
      },
      include: { sender: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: result.count,
    });

    // Broadcast each observation individually for real-time feed
    for (const obs of inserted) {
      sseManager.broadcast("observation", {
        ...obs,
        frequencyHz: obs.frequencyHz?.toString() ?? null,
      });
    }

    res.json({ received: result.count });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
