import { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createHash } from "crypto";
import { URL } from "url";
import {
  observationBatchSchema,
  computeSignature,
} from "@rf-telemetry/shared";
import prisma from "./services/db";
import sseManager from "./services/sse";
import logger from "./logger";

const wss = new WebSocketServer({ noServer: true });

async function authenticateSenderToken(
  token: string
): Promise<{ id: string; name: string } | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const sender = await prisma.sender.findUnique({
    where: { tokenHash },
  });

  if (!sender || sender.status !== "ACTIVE") {
    return null;
  }

  await prisma.sender.update({
    where: { id: sender.id },
    data: { lastSeenAt: new Date() },
  });

  return { id: sender.id, name: sender.name };
}

wss.on("connection", (ws: WebSocket, req: IncomingMessage, sender: { id: string; name: string }) => {
  logger.info({ senderId: sender.id, senderName: sender.name }, "WebSocket sender connected");

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      const parsed = observationBatchSchema.safeParse(message);
      if (!parsed.success) {
        ws.send(JSON.stringify({ ok: false, error: "Validation failed", details: parsed.error.flatten() }));
        return;
      }

      const { observations } = parsed.data;

      // Look up known signatures for classification
      const signatures = new Set<string>();
      const dataToInsert = observations.map((obs) => {
        const signature =
          obs.signature || computeSignature(obs.protocol, obs.fields as Record<string, unknown>);
        signatures.add(signature);
        return {
          senderId: sender.id,
          observedAt: new Date(obs.observedAt as string),
          protocol: obs.protocol,
          frequencyHz: obs.frequencyHz ? BigInt(obs.frequencyHz) : null,
          rssi: obs.rssi ?? null,
          signature,
          fields: obs.fields as object,
          raw: obs.raw ?? null,
          classification: "PENDING" as const,
        };
      });

      // Check which signatures are whitelisted
      const whitelisted = await prisma.whitelistEntry.findMany({
        where: { signature: { in: Array.from(signatures) } },
        select: { signature: true },
      });
      const whitelistedSet = new Set(whitelisted.map((w) => w.signature));

      // Set classification based on whitelist
      const finalData = dataToInsert.map((d) => ({
        ...d,
        classification: whitelistedSet.has(d.signature) ? ("KNOWN" as const) : ("PENDING" as const),
      }));

      // Bulk insert
      const result = await prisma.observation.createMany({
        data: finalData,
      });

      // Send ACK
      ws.send(JSON.stringify({ ok: true, received: result.count }));

      // Query inserted observations with sender info for SSE broadcast
      const inserted = await prisma.observation.findMany({
        where: {
          senderId: sender.id,
          receivedAt: { gte: new Date(Date.now() - 5000) },
          signature: { in: finalData.map((d) => d.signature) },
        },
        include: { sender: { select: { name: true } } },
        orderBy: { receivedAt: "desc" },
        take: result.count,
      });

      // Broadcast each observation individually for real-time feed
      for (const obs of inserted) {
        sseManager.broadcast("observation", {
          ...obs,
          frequencyHz: obs.frequencyHz?.toString() ?? null,
        });
      }

      // Update sender lastSeenAt
      await prisma.sender.update({
        where: { id: sender.id },
        data: { lastSeenAt: new Date() },
      });
    } catch (err) {
      logger.error({ err }, "WebSocket message processing error");
      ws.send(JSON.stringify({ ok: false, error: "Internal server error" }));
    }
  });

  ws.on("close", () => {
    logger.info({ senderId: sender.id }, "WebSocket sender disconnected");
  });

  ws.on("error", (err) => {
    logger.error({ err, senderId: sender.id }, "WebSocket error");
  });
});

export function handleUpgrade(req: IncomingMessage, socket: any, head: Buffer): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname !== "/ws/ingest") {
    socket.destroy();
    return;
  }

  // Extract token from query param
  const token = url.searchParams.get("token");

  if (!token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  authenticateSenderToken(token)
    .then((sender) => {
      if (!sender) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, sender);
      });
    })
    .catch((err) => {
      logger.error({ err }, "WebSocket upgrade authentication error");
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    });
}

export default wss;
