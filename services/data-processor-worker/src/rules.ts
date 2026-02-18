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
