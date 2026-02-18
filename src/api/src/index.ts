import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../.env") });

// BigInt JSON serialization support
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import logger from "./logger";
import { handleUpgrade } from "./ws";

// Route imports
import authRoutes from "./routes/auth";
import senderRoutes from "./routes/senders";
import ingestRoutes from "./routes/ingest";
import observationRoutes from "./routes/observations";
import whitelistRoutes from "./routes/whitelist";
import ruleRoutes from "./routes/rules";
import alertRoutes from "./routes/alerts";
import eventRoutes from "./routes/events";

const app = express();
const server = createServer(app);

// Global middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use(limiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount routes
app.use(authRoutes);
app.use(senderRoutes);
app.use(ingestRoutes);
app.use(observationRoutes);
app.use(whitelistRoutes);
app.use(ruleRoutes);
app.use(alertRoutes);
app.use(eventRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// WebSocket upgrade handling
server.on("upgrade", (req, socket, head) => {
  handleUpgrade(req, socket, head);
});

// Start server
const PORT = parseInt(process.env.API_PORT || "4000", 10);

server.listen(PORT, () => {
  logger.info({ port: PORT }, "RF Telemetry API server started");
});

export { app, server };
