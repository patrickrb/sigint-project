import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@rf-telemetry/shared";
import pino from "pino";
import { classifyObservations } from "./classifier";
import { evaluateRules } from "./rules";
import { cleanupRetention } from "./retention";

const logger = pino({ name: "worker" });
const prisma = new PrismaClient();

const POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL_MS || "2000");
const RETENTION_INTERVAL = parseInt(process.env.RETENTION_CHECK_INTERVAL_MS || "3600000");

async function pollCycle() {
  try {
    const classified = await classifyObservations(prisma, logger);
    if (classified > 0) {
      await evaluateRules(prisma, logger);
    }
  } catch (err) {
    logger.error({ err }, "Poll cycle error");
  }
}

async function main() {
  logger.info("Worker starting...");

  // Main poll loop
  setInterval(pollCycle, POLL_INTERVAL);

  // Retention cleanup loop
  setInterval(() => cleanupRetention(prisma, logger), RETENTION_INTERVAL);

  // Run once immediately
  await pollCycle();

  logger.info({ pollInterval: POLL_INTERVAL, retentionInterval: RETENTION_INTERVAL }, "Worker running");
}

main().catch((err) => {
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});
