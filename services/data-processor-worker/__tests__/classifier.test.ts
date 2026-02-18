import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PrismaClient
function createMockPrisma() {
  return {
    observation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    whitelistEntry: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((ops: any[]) => Promise.all(ops)),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("classifyObservations", () => {
  it("classifies whitelisted signatures as KNOWN", async () => {
    const prisma = createMockPrisma();
    const logger = createMockLogger();

    prisma.observation.findMany.mockResolvedValue([
      { id: "obs1", signature: "sig-known" },
      { id: "obs2", signature: "sig-unknown" },
    ]);

    prisma.whitelistEntry.findMany.mockResolvedValue([{ signature: "sig-known" }]);
    prisma.observation.updateMany.mockResolvedValue({ count: 1 });

    // Import and test
    const { classifyObservations } = await import("../src/classifier");
    const count = await classifyObservations(prisma as any, logger as any);

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("returns 0 when no pending observations", async () => {
    const prisma = createMockPrisma();
    const logger = createMockLogger();

    prisma.observation.findMany.mockResolvedValue([]);

    const { classifyObservations } = await import("../src/classifier");
    const count = await classifyObservations(prisma as any, logger as any);

    expect(count).toBe(0);
  });
});
