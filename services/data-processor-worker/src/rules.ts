import { PrismaClient } from "@rf-telemetry/shared";
import type { Logger } from "pino";

export async function evaluateRules(prisma: PrismaClient, logger: Logger): Promise<void> {
  const rules = await prisma.rule.findMany({ where: { enabled: true } });

  for (const rule of rules) {
    try {
      switch (rule.type) {
        case "UNKNOWN_BURST":
          await evaluateUnknownBurst(prisma, rule, logger);
          break;
        case "NEW_DEVICE":
          await evaluateNewDevice(prisma, rule, logger);
          break;
        case "BLE_TRACKER":
          await evaluateBleTracker(prisma, rule, logger);
          break;
        case "BLE_FLOOD":
          await evaluateBleFlood(prisma, rule, logger);
          break;
        case "SPECTRUM_ANOMALY":
          await evaluateSpectrumAnomaly(prisma, rule, logger);
          break;
      }
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, "Rule evaluation error");
    }
  }
}

async function evaluateUnknownBurst(prisma: PrismaClient, rule: any, logger: Logger) {
  const config = rule.config as { threshold: number; windowSeconds: number };
  const since = new Date(Date.now() - config.windowSeconds * 1000);

  // Group by senderId
  const counts = await prisma.observation.groupBy({
    by: ["senderId"],
    where: {
      classification: "UNKNOWN",
      receivedAt: { gte: since },
    },
    _count: true,
  });

  for (const group of counts) {
    if (group._count >= config.threshold) {
      // Check if alert already exists for this rule+sender in the window
      const existing = await prisma.alertEvent.findFirst({
        where: {
          ruleId: rule.id,
          senderId: group.senderId,
          createdAt: { gte: since },
        },
      });

      if (!existing) {
        await prisma.alertEvent.create({
          data: {
            ruleId: rule.id,
            senderId: group.senderId,
            severity: "WARNING",
            message: `Unknown burst: ${group._count} unknown observations from sender in ${config.windowSeconds}s (threshold: ${config.threshold})`,
            meta: { count: group._count, windowSeconds: config.windowSeconds } as object,
          },
        });
        logger.warn({ ruleId: rule.id, senderId: group.senderId, count: group._count }, "Unknown burst alert created");
      }
    }
  }
}

async function evaluateNewDevice(prisma: PrismaClient, rule: any, logger: Logger) {
  // Find signatures that appear exactly once and were classified recently (last 10 seconds)
  const recentWindow = new Date(Date.now() - 10000);

  const newObservations = await prisma.observation.findMany({
    where: {
      classification: "UNKNOWN",
      receivedAt: { gte: recentWindow },
    },
    select: { signature: true, senderId: true, protocol: true },
  });

  for (const obs of newObservations) {
    const totalCount = await prisma.observation.count({
      where: { signature: obs.signature },
    });

    if (totalCount === 1) {
      // Check for existing alert
      const existing = await prisma.alertEvent.findFirst({
        where: {
          ruleId: rule.id,
          meta: { path: ["signature"], equals: obs.signature },
        },
      });

      if (!existing) {
        await prisma.alertEvent.create({
          data: {
            ruleId: rule.id,
            senderId: obs.senderId,
            severity: "INFO",
            message: `New device detected: ${obs.protocol} (${obs.signature.slice(0, 12)}...)`,
            meta: { signature: obs.signature, protocol: obs.protocol } as object,
          },
        });
        logger.info({ ruleId: rule.id, signature: obs.signature.slice(0, 12) }, "New device alert created");
      }
    }
  }
}

async function evaluateBleTracker(prisma: PrismaClient, rule: any, logger: Logger) {
  const config = rule.config as { minObservations: number; windowMinutes: number; excludeKnown: boolean };
  const since = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  const whereClause: Record<string, unknown> = {
    protocol: "ble-adv",
    receivedAt: { gte: since },
  };
  if (config.excludeKnown) {
    whereClause.classification = "UNKNOWN";
  }

  // Group by signature to find persistent BLE devices
  const counts = await prisma.observation.groupBy({
    by: ["signature", "senderId"],
    where: whereClause,
    _count: true,
  });

  for (const group of counts) {
    if (group._count >= config.minObservations) {
      const existing = await prisma.alertEvent.findFirst({
        where: {
          ruleId: rule.id,
          meta: { path: ["signature"], equals: group.signature },
          createdAt: { gte: since },
        },
      });

      if (!existing) {
        await prisma.alertEvent.create({
          data: {
            ruleId: rule.id,
            senderId: group.senderId,
            severity: "WARNING",
            message: `Persistent BLE device: ${group.signature.slice(0, 12)}... seen ${group._count} times in ${config.windowMinutes} minutes`,
            meta: {
              signature: group.signature,
              count: group._count,
              windowMinutes: config.windowMinutes,
            } as object,
          },
        });
        logger.warn({ ruleId: rule.id, signature: group.signature.slice(0, 12), count: group._count }, "BLE tracker alert created");
      }
    }
  }
}

async function evaluateBleFlood(prisma: PrismaClient, rule: any, logger: Logger) {
  const config = rule.config as { threshold: number; windowSeconds: number };
  const since = new Date(Date.now() - config.windowSeconds * 1000);

  // Count all BLE observations per sender in the window
  const counts = await prisma.observation.groupBy({
    by: ["senderId"],
    where: {
      protocol: { startsWith: "ble-" },
      receivedAt: { gte: since },
    },
    _count: true,
  });

  for (const group of counts) {
    if (group._count >= config.threshold) {
      const existing = await prisma.alertEvent.findFirst({
        where: {
          ruleId: rule.id,
          senderId: group.senderId,
          createdAt: { gte: since },
        },
      });

      if (!existing) {
        await prisma.alertEvent.create({
          data: {
            ruleId: rule.id,
            senderId: group.senderId,
            severity: "CRITICAL",
            message: `BLE flood detected: ${group._count} BLE observations in ${config.windowSeconds}s (threshold: ${config.threshold})`,
            meta: {
              count: group._count,
              windowSeconds: config.windowSeconds,
            } as object,
          },
        });
        logger.warn({ ruleId: rule.id, senderId: group.senderId, count: group._count }, "BLE flood alert created");
      }
    }
  }
}

async function evaluateSpectrumAnomaly(prisma: PrismaClient, rule: any, logger: Logger) {
  const config = rule.config as { minStreakMinutes: number; minDeviationSigma: number };
  const since = new Date(Date.now() - config.minStreakMinutes * 60 * 1000);

  // Find spectrum-anomaly observations that recur at similar frequencies
  const anomalies = await prisma.observation.groupBy({
    by: ["signature", "senderId"],
    where: {
      protocol: "spectrum-anomaly",
      receivedAt: { gte: since },
    },
    _count: true,
    _min: { receivedAt: true },
    _max: { receivedAt: true },
  });

  for (const group of anomalies) {
    // Must have multiple occurrences spanning the time window
    if (group._count < 2) continue;

    const minTime = group._min.receivedAt;
    const maxTime = group._max.receivedAt;
    if (!minTime || !maxTime) continue;

    const spanMinutes = (maxTime.getTime() - minTime.getTime()) / 60000;
    if (spanMinutes < config.minStreakMinutes * 0.5) continue; // At least half the window

    const existing = await prisma.alertEvent.findFirst({
      where: {
        ruleId: rule.id,
        meta: { path: ["signature"], equals: group.signature },
        createdAt: { gte: since },
      },
    });

    if (!existing) {
      // Get the most recent anomaly for metadata
      const latest = await prisma.observation.findFirst({
        where: { signature: group.signature, protocol: "spectrum-anomaly" },
        orderBy: { receivedAt: "desc" },
        select: { fields: true, frequencyHz: true },
      });

      const fields = latest?.fields as Record<string, unknown> | null;

      await prisma.alertEvent.create({
        data: {
          ruleId: rule.id,
          senderId: group.senderId,
          severity: "WARNING",
          message: `Persistent spectrum anomaly: ${fields?.band || "unknown band"} — ${group._count} detections over ${Math.round(spanMinutes)} minutes`,
          meta: {
            signature: group.signature,
            count: group._count,
            spanMinutes: Math.round(spanMinutes),
            band: fields?.band,
            frequencyHz: latest?.frequencyHz?.toString(),
          } as object,
        },
      });
      logger.warn({
        ruleId: rule.id,
        signature: group.signature.slice(0, 12),
        count: group._count,
        band: fields?.band,
      }, "Spectrum anomaly alert created");
    }
  }
}
