import { PrismaClient } from "@rf-telemetry/shared";
import type { Logger } from "pino";

export async function classifyObservations(prisma: PrismaClient, logger: Logger): Promise<number> {
  const pending = await prisma.observation.findMany({
    where: { classification: "PENDING" },
    select: { id: true, signature: true },
    take: 200,
    orderBy: { receivedAt: "asc" },
  });

  if (pending.length === 0) return 0;

  const uniqueSignatures = [...new Set(pending.map((o) => o.signature))];

  const whitelisted = await prisma.whitelistEntry.findMany({
    where: { signature: { in: uniqueSignatures } },
    select: { signature: true },
  });

  const whitelistedSet = new Set(whitelisted.map((w) => w.signature));

  const knownIds = pending.filter((o) => whitelistedSet.has(o.signature)).map((o) => o.id);
  const unknownIds = pending.filter((o) => !whitelistedSet.has(o.signature)).map((o) => o.id);

  await prisma.$transaction([
    ...(knownIds.length > 0
      ? [prisma.observation.updateMany({ where: { id: { in: knownIds } }, data: { classification: "KNOWN" } })]
      : []),
    ...(unknownIds.length > 0
      ? [prisma.observation.updateMany({ where: { id: { in: unknownIds } }, data: { classification: "UNKNOWN" } })]
      : []),
  ]);

  logger.info({ total: pending.length, known: knownIds.length, unknown: unknownIds.length }, "Classified observations");
  return pending.length;
}
