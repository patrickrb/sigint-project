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

// RSSI signal strength distribution: bucket observations by dBm range
router.get("/api/observations/rssi-distribution", authenticateUser, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
      SELECT bucket, count FROM (
        SELECT
          CASE
            WHEN rssi IS NULL THEN 'No data'
            WHEN rssi >= -30 THEN '-30+'
            WHEN rssi >= -40 THEN '-40 to -31'
            WHEN rssi >= -50 THEN '-50 to -41'
            WHEN rssi >= -60 THEN '-60 to -51'
            WHEN rssi >= -70 THEN '-70 to -61'
            WHEN rssi >= -80 THEN '-80 to -71'
            WHEN rssi >= -90 THEN '-90 to -81'
            ELSE 'Below -90'
          END AS bucket,
          COUNT(*)::bigint AS count,
          CASE
            WHEN rssi IS NULL THEN -1
            WHEN rssi >= -30 THEN 7
            WHEN rssi >= -40 THEN 6
            WHEN rssi >= -50 THEN 5
            WHEN rssi >= -60 THEN 4
            WHEN rssi >= -70 THEN 3
            WHEN rssi >= -80 THEN 2
            WHEN rssi >= -90 THEN 1
            ELSE 0
          END AS sort_order
        FROM observations
        GROUP BY bucket, sort_order
      ) sub
      ORDER BY sort_order ASC
    `;

    const distribution = rows
      .filter((r) => r.bucket !== "No data")
      .map((r) => ({
        range: r.bucket,
        count: Number(r.count),
      }));

    res.json({ distribution });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// SNR quality distribution: bucket observations by signal-to-noise ratio
router.get("/api/observations/snr-distribution", authenticateUser, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
      SELECT bucket, count FROM (
        SELECT
          CASE
            WHEN snr IS NULL THEN 'No data'
            WHEN snr >= 20 THEN 'Excellent (20+)'
            WHEN snr >= 10 THEN 'Good (10-20)'
            WHEN snr >= 5  THEN 'Fair (5-10)'
            ELSE 'Poor (<5)'
          END AS bucket,
          COUNT(*)::bigint AS count,
          CASE
            WHEN snr IS NULL THEN -1
            WHEN snr >= 20 THEN 3
            WHEN snr >= 10 THEN 2
            WHEN snr >= 5  THEN 1
            ELSE 0
          END AS sort_order
        FROM observations
        GROUP BY bucket, sort_order
      ) sub
      ORDER BY sort_order ASC
    `;

    const distribution = rows
      .filter((r) => r.bucket !== "No data")
      .map((r) => ({
        range: r.bucket,
        count: Number(r.count),
      }));

    res.json({ distribution });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Noise floor timeline: average/min/max noise per minute
router.get("/api/observations/noise-timeline", authenticateUser, async (req: Request, res: Response) => {
  try {
    const minutes = Math.min(parseInt(req.query.minutes as string) || 60, 1440);
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; avg_noise: number; min_noise: number; max_noise: number }>>`
      SELECT date_trunc('minute', "receivedAt") AS bucket,
             AVG(noise)::float AS avg_noise,
             MIN(noise)::float AS min_noise,
             MAX(noise)::float AS max_noise
      FROM observations
      WHERE "receivedAt" >= ${since} AND noise IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const timeline = rows.map((r) => ({
      time: r.bucket.toISOString(),
      avgNoise: Math.round(r.avg_noise * 10) / 10,
      minNoise: Math.round(r.min_noise * 10) / 10,
      maxNoise: Math.round(r.max_noise * 10) / 10,
    }));

    res.json({ timeline });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Timeline histogram: observation counts bucketed by minute over the last hour
router.get("/api/observations/timeline", authenticateUser, async (req: Request, res: Response) => {
  try {
    const minutes = Math.min(parseInt(req.query.minutes as string) || 60, 1440);
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('minute', "receivedAt") AS bucket, COUNT(*)::bigint AS count
      FROM observations
      WHERE "receivedAt" >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const timeline = rows.map((r) => ({
      time: r.bucket.toISOString(),
      count: Number(r.count),
    }));

    res.json({ timeline });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Protocol breakdown: top protocols by observation count
router.get("/api/observations/protocols", authenticateUser, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<Array<{ protocol: string; count: bigint }>>`
      SELECT protocol, COUNT(*)::bigint AS count
      FROM observations
      GROUP BY protocol
      ORDER BY count DESC
      LIMIT 20
    `;

    const protocols = rows.map((r) => ({
      protocol: r.protocol,
      count: Number(r.count),
    }));

    res.json({ protocols });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Classification breakdown over time: buckets by minute with known/unknown/pending counts
router.get("/api/observations/classification-timeline", authenticateUser, async (req: Request, res: Response) => {
  try {
    const minutes = Math.min(parseInt(req.query.minutes as string) || 60, 1440);
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; classification: string; count: bigint }>>`
      SELECT date_trunc('minute', "receivedAt") AS bucket, classification, COUNT(*)::bigint AS count
      FROM observations
      WHERE "receivedAt" >= ${since}
      GROUP BY bucket, classification
      ORDER BY bucket ASC
    `;

    // Pivot into { time, KNOWN, UNKNOWN, PENDING }
    const map = new Map<string, { time: string; KNOWN: number; UNKNOWN: number; PENDING: number }>();
    for (const row of rows) {
      const key = row.bucket.toISOString();
      if (!map.has(key)) {
        map.set(key, { time: key, KNOWN: 0, UNKNOWN: 0, PENDING: 0 });
      }
      const entry = map.get(key)!;
      if (row.classification === "KNOWN" || row.classification === "UNKNOWN" || row.classification === "PENDING") {
        entry[row.classification] = Number(row.count);
      }
    }

    res.json({ timeline: Array.from(map.values()) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/observations/:id/approve", authenticateUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const observation = await prisma.observation.findUnique({
      where: { id },
      select: { id: true, signature: true, protocol: true, classification: true },
    });

    if (!observation) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }

    if (observation.classification === "KNOWN") {
      res.json({ message: "Already known", observation });
      return;
    }

    // Create whitelist entry (skip if signature already whitelisted)
    const existing = await prisma.whitelistEntry.findUnique({
      where: { signature: observation.signature },
    });

    if (!existing) {
      await prisma.whitelistEntry.create({
        data: {
          signature: observation.signature,
          label: `${observation.protocol} device`,
          protocol: observation.protocol,
          userId: req.user!.userId,
        },
      });
    }

    // Mark this observation and all others with the same signature as KNOWN
    const updated = await prisma.observation.updateMany({
      where: { signature: observation.signature, classification: { in: ["PENDING", "UNKNOWN"] } },
      data: { classification: "KNOWN" },
    });

    res.json({ approved: true, updated: updated.count });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
