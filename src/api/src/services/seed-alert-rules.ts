import prisma from "./db";
import logger from "../logger";

const DEFAULT_ALERT_RULES = [
  {
    name: "BLE Tracker Detection",
    type: "BLE_TRACKER" as const,
    config: { minObservations: 10, windowMinutes: 30, excludeKnown: true },
    enabled: false,
  },
  {
    name: "BLE Flood / Jamming",
    type: "BLE_FLOOD" as const,
    config: { threshold: 500, windowSeconds: 60 },
    enabled: false,
  },
  {
    name: "Persistent Spectrum Anomaly",
    type: "SPECTRUM_ANOMALY" as const,
    config: { minStreakMinutes: 5, minDeviationSigma: 4.0 },
    enabled: false,
  },
  {
    name: "BLE Tracker Detected",
    type: "BLE_TRACKER_DETECTED" as const,
    config: { trackerTypes: ["Apple Find My", "Tile", "Samsung SmartTag", "Chipolo"], cooldownMinutes: 60 },
    enabled: false,
  },
  {
    name: "BLE New Device",
    type: "BLE_NEW_DEVICE" as const,
    config: { minObservations: 3, excludeKnown: true },
    enabled: false,
  },
  {
    name: "BLE Jamming Detection",
    type: "BLE_JAMMING" as const,
    config: { minDeviationDb: 6.0, sustainedSeconds: 30 },
    enabled: false,
  },
];

export async function seedAlertRules(): Promise<void> {
  try {
    // Find the first admin user to assign rules to
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (!admin) {
      logger.debug("No admin user found — skipping alert rule seeding");
      return;
    }

    let created = 0;
    for (const rule of DEFAULT_ALERT_RULES) {
      const existing = await prisma.rule.findFirst({
        where: { type: rule.type, userId: admin.id },
      });

      if (!existing) {
        await prisma.rule.create({
          data: {
            userId: admin.id,
            name: rule.name,
            type: rule.type,
            config: rule.config as object,
            enabled: rule.enabled,
          },
        });
        created++;
      }
    }

    if (created > 0) {
      logger.info({ count: created }, "Seeded default alert rules (disabled)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed alert rules");
  }
}
