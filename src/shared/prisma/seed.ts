import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function computeSignature(protocol: string, fields: Record<string, string>): string {
  const salt = "rf-telemetry-v1";
  const sorted = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHash("sha256").update(`${salt}:${protocol}:${sorted}`).digest("hex");
}

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.alertEvent.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.whitelistEntry.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.sender.deleteMany();
  await prisma.user.deleteMany();

  // Create admin user (password: admin123)
  const bcryptjs = await import("bcryptjs");
  const hash = bcryptjs.default?.hash ?? bcryptjs.hash;
  const adminHash = await hash("admin123", 10);
  const admin = await prisma.user.create({
    data: {
      email: "admin@local",
      passwordHash: adminHash,
      name: "Admin",
      role: "ADMIN",
    },
  });
  console.log(`Created admin user: ${admin.email}`);

  // Create senders with known tokens
  const sender1Token = "sender-token-alpha-00000000";
  const sender2Token = "sender-token-bravo-00000000";

  const sender1 = await prisma.sender.create({
    data: {
      name: "Living Room Receiver",
      tokenHash: hashToken(sender1Token),
      userId: admin.id,
      status: "ACTIVE",
      lastSeenAt: new Date(),
    },
  });

  const sender2 = await prisma.sender.create({
    data: {
      name: "Garage Receiver",
      tokenHash: hashToken(sender2Token),
      userId: admin.id,
      status: "ACTIVE",
      lastSeenAt: new Date(Date.now() - 600000),
    },
  });

  console.log(`Created senders: ${sender1.name}, ${sender2.name}`);
  console.log(`  Sender 1 token: ${sender1Token}`);
  console.log(`  Sender 1 ID: ${sender1.id}`);
  console.log(`  Sender 2 token: ${sender2Token}`);
  console.log(`  Sender 2 ID: ${sender2.id}`);

  // Known device signatures
  const knownDevices = [
    { protocol: "temperature", fields: { device_id: "thermometer-kitchen", channel: "1" }, label: "Kitchen Thermometer" },
    { protocol: "temperature", fields: { device_id: "thermometer-garage", channel: "2" }, label: "Garage Thermometer" },
    { protocol: "humidity", fields: { device_id: "humidity-basement", channel: "1" }, label: "Basement Humidity" },
    { protocol: "door_sensor", fields: { device_id: "door-front", channel: "1" }, label: "Front Door Sensor" },
    { protocol: "weather_station", fields: { device_id: "weather-station-1", channel: "3" }, label: "Backyard Weather" },
  ];

  // Create whitelist entries
  for (const device of knownDevices) {
    const sig = computeSignature(device.protocol, device.fields);
    await prisma.whitelistEntry.create({
      data: {
        userId: admin.id,
        signature: sig,
        label: device.label,
        protocol: device.protocol,
      },
    });
  }
  console.log(`Created ${knownDevices.length} whitelist entries`);

  // Create rules
  const burstRule = await prisma.rule.create({
    data: {
      userId: admin.id,
      name: "Unknown Burst Detection",
      type: "UNKNOWN_BURST",
      config: { threshold: 10, windowSeconds: 60 },
      enabled: true,
    },
  });

  const newDeviceRule = await prisma.rule.create({
    data: {
      userId: admin.id,
      name: "New Device Detection",
      type: "NEW_DEVICE",
      config: {},
      enabled: true,
    },
  });
  console.log(`Created rules: ${burstRule.name}, ${newDeviceRule.name}`);

  // Generate sample observations
  const now = Date.now();
  const observations = [];

  for (let i = 0; i < 100; i++) {
    const isKnown = Math.random() < 0.7;
    const ago = Math.floor(Math.random() * 3600000); // random time in last hour
    const sender = Math.random() < 0.6 ? sender1 : sender2;

    if (isKnown) {
      const device = knownDevices[Math.floor(Math.random() * knownDevices.length)];
      const sig = computeSignature(device.protocol, device.fields);
      const value = device.protocol === "temperature"
        ? String((15 + Math.random() * 20).toFixed(1))
        : device.protocol === "door_sensor"
          ? String(Math.round(Math.random()))
          : String(Math.floor(30 + Math.random() * 60));

      observations.push({
        senderId: sender.id,
        observedAt: new Date(now - ago),
        receivedAt: new Date(now - ago + 100),
        protocol: device.protocol,
        frequencyHz: BigInt(433920000),
        rssi: -(30 + Math.random() * 60),
        signature: sig,
        fields: { ...device.fields, value },
        classification: "KNOWN" as const,
      });
    } else {
      const protocol = ["temperature", "humidity", "motion"][Math.floor(Math.random() * 3)];
      const unknownId = `unknown-${randomBytes(2).toString("hex")}`;
      const sig = computeSignature(protocol, { device_id: unknownId, channel: "0" });

      observations.push({
        senderId: sender.id,
        observedAt: new Date(now - ago),
        receivedAt: new Date(now - ago + 100),
        protocol,
        frequencyHz: BigInt(433920000),
        rssi: -(30 + Math.random() * 60),
        signature: sig,
        fields: { device_id: unknownId, channel: "0", value: "0" },
        classification: "UNKNOWN" as const,
      });
    }
  }

  await prisma.observation.createMany({ data: observations });
  console.log(`Created ${observations.length} sample observations`);

  // Create sample alerts
  await prisma.alertEvent.create({
    data: {
      ruleId: burstRule.id,
      senderId: sender1.id,
      severity: "WARNING",
      message: "Unknown burst: 15 unknown observations in 60s (threshold: 10)",
      meta: { count: 15, windowSeconds: 60 },
      createdAt: new Date(now - 1800000),
    },
  });

  await prisma.alertEvent.create({
    data: {
      ruleId: newDeviceRule.id,
      senderId: sender2.id,
      severity: "INFO",
      message: "New device detected: motion (a1b2c3d4e5f6...)",
      meta: { signature: "a1b2c3d4e5f6", protocol: "motion" },
      createdAt: new Date(now - 900000),
    },
  });

  await prisma.alertEvent.create({
    data: {
      ruleId: burstRule.id,
      senderId: sender2.id,
      severity: "WARNING",
      message: "Unknown burst: 12 unknown observations in 60s (threshold: 10)",
      meta: { count: 12, windowSeconds: 60 },
      acknowledgedAt: new Date(now - 600000),
      createdAt: new Date(now - 3600000),
    },
  });

  console.log("Created 3 sample alerts");
  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
