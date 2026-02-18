import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import sseManager from "../services/sse";

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret";

const router = Router();

// SSE endpoint - supports both Authorization header and ?token= query param
// (EventSource API doesn't support custom headers)
router.get("/api/events", (req: Request, res: Response) => {
  let token = "";

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: "Missing authentication" });
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  sseManager.addClient(res);
});

export default router;
