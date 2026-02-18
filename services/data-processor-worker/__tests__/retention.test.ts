import { describe, it, expect, vi } from "vitest";

function createMockPrisma() {
  return {
    observation: {
      deleteMany: vi.fn(),
    },
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("cleanupRetention", () => {
  it("deletes old unknown observations", async () => {
    const prisma = createMockPrisma();
    const logger = createMockLogger();

    prisma.observation.deleteMany.mockResolvedValue({ count: 5 });

    const { cleanupRetention } = await import("../src/retention");
    const deleted = await cleanupRetention(prisma as any, logger as any);

    expect(deleted).toBe(5);
    expect(prisma.observation.deleteMany).toHaveBeenCalledWith({
      where: {
        classification: "UNKNOWN",
        receivedAt: { lt: expect.any(Date) },
      },
    });
    expect(logger.info).toHaveBeenCalled();
  });

  it("does not log when nothing deleted", async () => {
    const prisma = createMockPrisma();
    const logger = createMockLogger();

    prisma.observation.deleteMany.mockResolvedValue({ count: 0 });

    const { cleanupRetention } = await import("../src/retention");
    const deleted = await cleanupRetention(prisma as any, logger as any);

    expect(deleted).toBe(0);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
