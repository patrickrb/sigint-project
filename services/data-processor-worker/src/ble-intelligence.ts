import { PrismaClient } from "@rf-telemetry/shared";
import type { Logger } from "pino";

/**
 * BLE Intelligence processor — runs every worker cycle.
 * Finds recent ble-adv observations with fingerprintId, groups by fingerprint,
 * and upserts into BleDevice with merged MAC hashes, running avg RSSI,
 * device type inference, and tracker metadata.
 */
export async function processBleIntelligence(prisma: PrismaClient, logger: Logger): Promise<void> {
  // Find recent ble-adv observations not yet processed (last 30 seconds)
  const since = new Date(Date.now() - 30_000);

  const observations = await prisma.observation.findMany({
    where: {
      protocol: "ble-adv",
      receivedAt: { gte: since },
    },
    select: {
      id: true,
      fields: true,
      rssi: true,
      receivedAt: true,
      senderId: true,
    },
    orderBy: { receivedAt: "asc" },
    take: 500,
  });

  if (observations.length === 0) return;

  // Group by fingerprintId
  const groups = new Map<string, typeof observations>();
  for (const obs of observations) {
    const fields = obs.fields as Record<string, unknown> | null;
    const fpId = fields?.fingerprintId as string | undefined;
    if (!fpId) continue;

    if (!groups.has(fpId)) groups.set(fpId, []);
    groups.get(fpId)!.push(obs);
  }

  let upserted = 0;
  for (const [fingerprintId, obsGroup] of groups) {
    try {
      const firstObs = obsGroup[0];
      const lastObs = obsGroup[obsGroup.length - 1];
      const fields = firstObs.fields as Record<string, unknown>;

      // Collect MAC hashes
      const macHashes = new Set<string>();
      const rssiValues: number[] = [];
      for (const obs of obsGroup) {
        const f = obs.fields as Record<string, unknown>;
        if (f?.macHash) macHashes.add(f.macHash as string);
        if (obs.rssi != null) rssiValues.push(obs.rssi);
      }

      const avgRssi = rssiValues.length > 0
        ? rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length
        : null;

      // Infer device type
      const deviceType = inferDeviceType(fields);
      const trackerType = (fields.trackerType as string) || null;
      const manufacturerId = (fields.manufacturerId as string) || null;
      const manufacturerName = (fields.manufacturerName as string) || null;
      const serviceUuids = Array.isArray(fields.serviceUuids) ? fields.serviceUuids : [];

      // Build meta from intelligence fields
      const meta: Record<string, unknown> = {};
      if (fields.continuityType) meta.continuityType = fields.continuityType;
      if (fields.cfoHz != null) meta.cfoHz = fields.cfoHz;
      if (fields.ibeaconUuid) meta.ibeaconUuid = fields.ibeaconUuid;
      if (fields.activityLevel != null) meta.activityLevel = fields.activityLevel;
      if (fields.deviceName) meta.deviceName = fields.deviceName;

      // Upsert BleDevice
      const existing = await prisma.bleDevice.findUnique({
        where: { fingerprintId },
        select: { macHashes: true, observationCount: true, avgRssi: true },
      });

      if (existing) {
        // Merge MAC hashes
        const existingMacs = Array.isArray(existing.macHashes) ? existing.macHashes as string[] : [];
        for (const m of existingMacs) macHashes.add(m);

        // Running average RSSI
        const prevCount = existing.observationCount;
        const prevAvg = existing.avgRssi || 0;
        const newCount = prevCount + obsGroup.length;
        const combinedAvg = avgRssi != null
          ? (prevAvg * prevCount + avgRssi * obsGroup.length) / newCount
          : prevAvg;

        await prisma.bleDevice.update({
          where: { fingerprintId },
          data: {
            lastSeen: lastObs.receivedAt,
            observationCount: newCount,
            avgRssi: Math.round(combinedAvg * 10) / 10,
            macHashes: Array.from(macHashes) as unknown as object,
            serviceUuids: serviceUuids as unknown as object,
            meta: (Object.keys(meta).length > 0 ? meta : undefined) as object | undefined,
            trackerType: trackerType ?? undefined,
            deviceType,
          },
        });
      } else {
        await prisma.bleDevice.create({
          data: {
            fingerprintId,
            deviceType,
            trackerType,
            manufacturerId,
            manufacturerName,
            firstSeen: firstObs.receivedAt,
            lastSeen: lastObs.receivedAt,
            observationCount: obsGroup.length,
            avgRssi: avgRssi != null ? Math.round(avgRssi * 10) / 10 : null,
            macHashes: Array.from(macHashes) as unknown as object,
            serviceUuids: serviceUuids as unknown as object,
            meta: (Object.keys(meta).length > 0 ? meta : undefined) as object | undefined,
            displayName: (fields.deviceName as string) || null,
          },
        });
      }

      upserted++;
    } catch (err) {
      logger.error({ err, fingerprintId }, "Failed to upsert BleDevice");
    }
  }

  if (upserted > 0) {
    logger.info({ upserted, observations: observations.length }, "BLE intelligence processed");
  }
}

type DeviceType = "PHONE" | "TRACKER" | "BEACON" | "IOT" | "WEARABLE" | "COMPUTER" | "UNKNOWN";

function inferDeviceType(fields: Record<string, unknown>): DeviceType {
  // Tracker detection takes priority
  if (fields.trackerType) return "TRACKER";

  const mfgId = fields.manufacturerId as string | undefined;
  const continuityType = fields.continuityType as string | undefined;
  const serviceUuids = (fields.serviceUuids as string[]) || [];
  const deviceName = (fields.deviceName as string) || "";

  // Apple device sub-types
  if (mfgId === "004c") {
    if (continuityType === "AirPods") return "WEARABLE";
    if (continuityType === "iBeacon") return "BEACON";
    if (continuityType === "NearbyInfo" || continuityType === "Handoff") return "PHONE";
    if (continuityType === "FindMy") return "TRACKER";
  }

  // Wearable hints
  if (deviceName.toLowerCase().match(/watch|band|ring|fitbit|garmin/)) return "WEARABLE";
  if (mfgId === "0087") return "WEARABLE"; // Garmin

  // Computer/phone hints
  if (deviceName.toLowerCase().match(/macbook|laptop|desktop|pc/)) return "COMPUTER";

  // IoT hints
  if (serviceUuids.includes("1800") || serviceUuids.includes("1801")) return "IOT";
  if (mfgId === "02ff") return "IOT"; // Espressif

  // Beacon hints
  if (fields.ibeaconUuid) return "BEACON";

  // Phone hints (Apple/Samsung/Google with generic continuity)
  if (mfgId === "004c" || mfgId === "0075" || mfgId === "00e0") return "PHONE";

  return "UNKNOWN";
}
