import { Router, Request, Response } from "express";
import { bleDeviceQuerySchema, bleDeviceClassifySchema } from "@rf-telemetry/shared";
import prisma from "../services/db";
import { authenticateUser } from "../middleware/auth";

const router = Router();

// List BLE device identities with filters
router.get("/api/ble-devices", authenticateUser, async (req: Request, res: Response) => {
  try {
    const parsed = bleDeviceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { deviceType, classification, trackerType, since, limit, offset } = parsed.data;

    const where: Record<string, unknown> = {};
    if (deviceType) where.deviceType = deviceType;
    if (classification) where.classification = classification;
    if (trackerType) where.trackerType = trackerType;
    if (since) where.lastSeen = { gte: since };

    const [devices, total] = await Promise.all([
      prisma.bleDevice.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { lastSeen: "desc" },
      }),
      prisma.bleDevice.count({ where }),
    ]);

    res.json({ devices, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Single device with recent observations
router.get("/api/ble-devices/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const device = await prisma.bleDevice.findUnique({ where: { id } });
    if (!device) {
      res.status(404).json({ error: "BLE device not found" });
      return;
    }

    // Get recent observations for this fingerprint
    const observations = await prisma.$queryRaw<Array<{
      id: string;
      observed_at: Date;
      received_at: Date;
      rssi: number | null;
      fields: unknown;
      classification: string;
    }>>`
      SELECT id, "observedAt" AS observed_at, "receivedAt" AS received_at, rssi, fields, classification
      FROM observations
      WHERE protocol = 'ble-adv'
        AND fields->>'fingerprintId' = ${device.fingerprintId}
      ORDER BY "receivedAt" DESC
      LIMIT 50
    `;

    const recentObservations = observations.map((r) => ({
      id: r.id,
      observedAt: r.observed_at.toISOString(),
      receivedAt: r.received_at.toISOString(),
      rssi: r.rssi,
      fields: r.fields,
      classification: r.classification,
    }));

    res.json({ device, observations: recentObservations });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Classify a BLE device (KNOWN/UNKNOWN/THREAT)
router.post("/api/ble-devices/:id/classify", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = bleDeviceClassifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const device = await prisma.bleDevice.findUnique({ where: { id } });
    if (!device) {
      res.status(404).json({ error: "BLE device not found" });
      return;
    }

    const updated = await prisma.bleDevice.update({
      where: { id },
      data: {
        classification: parsed.data.classification,
        displayName: parsed.data.displayName ?? device.displayName,
      },
    });

    res.json({ device: updated });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
