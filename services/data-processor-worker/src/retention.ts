import { PrismaClient, RETENTION_DAYS } from "@rf-telemetry/shared";
import type { Logger } from "pino";

export async function cleanupRetention(prisma: PrismaClient, logger: Logger): Promise<number> {
  const retentionDays = parseInt(process.env.RETENTION_DAYS || String(RETENTION_DAYS));
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.observation.deleteMany({
    where: {
      classification: "UNKNOWN",
      receivedAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    logger.info({ deleted: result.count, cutoffDate: cutoff.toISOString() }, "Retention cleanup completed");
  }

  return result.count;
}
