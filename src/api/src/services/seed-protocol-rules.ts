import prisma from "./db";
import logger from "../logger";

const DEFAULT_RULES = [
  { pattern: "acurite-*", classification: "KNOWN" as const, label: "Weather Stations - Acurite" },
  { pattern: "oregon-*", classification: "KNOWN" as const, label: "Weather Stations - Oregon Scientific" },
  { pattern: "lacrosse-*", classification: "KNOWN" as const, label: "Weather Stations - LaCrosse" },
  { pattern: "ambient-*", classification: "KNOWN" as const, label: "Weather Stations - Ambient Weather" },
  { pattern: "nexus-*", classification: "KNOWN" as const, label: "Weather Stations - Nexus" },
  { pattern: "tpms", classification: "KNOWN" as const, label: "Tire Pressure Sensors" },
  { pattern: "maverick-*", classification: "KNOWN" as const, label: "BBQ/Food Thermometers" },
  { pattern: "spectrum-anomaly", classification: "UNKNOWN" as const, label: "Spectrum Anomalies" },
  { pattern: "spectrum-baseline", classification: "KNOWN" as const, label: "Spectrum Baselines" },
  { pattern: "ble-*", classification: "UNKNOWN" as const, label: "Bluetooth Low Energy" },
];

export async function seedProtocolRules(): Promise<void> {
  try {
    const result = await prisma.protocolRule.createMany({
      data: DEFAULT_RULES,
      skipDuplicates: true,
    });

    if (result.count > 0) {
      logger.info({ count: result.count }, "Seeded default protocol rules");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed protocol rules");
  }
}
