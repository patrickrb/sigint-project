import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

// Mock the auth middleware
const JWT_SECRET = "test-secret";

describe("authenticateUser middleware", () => {
  it("rejects requests without Authorization header", async () => {
    const { authenticateUser } = await import("../src/middleware/auth");
    const req = { headers: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens", async () => {
    const { authenticateUser } = await import("../src/middleware/auth");
    const req = { headers: { authorization: "Bearer invalid-token" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts valid JWT and attaches user", async () => {
    const { authenticateUser } = await import("../src/middleware/auth");
    const payload = { userId: "u1", email: "test@test.com", role: "ADMIN" };
    const token = jwt.sign(payload, process.env.JWT_SECRET || "dev-jwt-secret");

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe("u1");
    expect(req.user.email).toBe("test@test.com");
  });
});
