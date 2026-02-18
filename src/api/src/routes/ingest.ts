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

    // Check which signatures are whitelisted
    const whitelisted = await prisma.whitelistEntry.findMany({
      where: { signature: { in: Array.from(signatures) } },
      select: { signature: true },
    });
    const whitelistedSet = new Set(whitelisted.map((w) => w.signature));

    // Set classification based on whitelist
    const finalData = dataToInsert.map((d) => ({
      ...d,
      classification: whitelistedSet.has(d.signature) ? ("KNOWN" as const) : ("PENDING" as const),
    }));

    // Bulk insert
    const result = await prisma.observation.createMany({
      data: finalData,
    });

    // Broadcast new observations via SSE
    sseManager.broadcast("observations", {
      senderId,
      senderName: req.sender!.name,
      count: result.count,
      protocols: [...new Set(observations.map((o) => o.protocol))],
    });

    res.json({ received: result.count });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
