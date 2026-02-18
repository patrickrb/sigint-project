import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import prisma from "../services/db";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      };
      sender?: {
        id: string;
        name: string;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret";

export function authenticateUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: string;
    };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function authenticateSender(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  try {
    const sender = await prisma.sender.findUnique({
      where: { tokenHash },
    });

    if (!sender) {
      res.status(401).json({ error: "Invalid sender token" });
      return;
    }

    if (sender.status !== "ACTIVE") {
      res.status(403).json({ error: "Sender token has been revoked" });
      return;
    }

    await prisma.sender.update({
      where: { id: sender.id },
      data: { lastSeenAt: new Date() },
    });

    req.sender = { id: sender.id, name: sender.name };
    next();
  } catch (err) {
    next(err);
  }
}
