import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import config from "../../config";
import { createSseHandler } from "../../api/run/run.sse";

describe("SSE Stream Auth & Access Control", () => {
  let app: express.Express;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      workflowRun: {
        findUnique: vi.fn(),
      },
      organizationMember: {
        findUnique: vi.fn(),
      },
    };

    app = express();
    app.get("/api/runs/:runId/stream", createSseHandler(mockPrisma));
  });

  it("returns 401 UNAUTHORIZED when no token is provided", async () => {
    const res = await request(app).get("/api/runs/run-123/stream");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("UNAUTHORIZED");
  });

  it("returns 401 UNAUTHORIZED when an invalid token is provided", async () => {
    const res = await request(app).get("/api/runs/run-123/stream?token=bad-token");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("UNAUTHORIZED");
  });

  it("returns 404 NOT_FOUND when workflow run does not exist", async () => {
    const validToken = jwt.sign({ userId: "user-1" }, config.JWT_SECRET);
    mockPrisma.workflowRun.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/runs/run-999/stream?token=${validToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("NOT_FOUND");
  });

  it("returns 403 FORBIDDEN when user does not own the run or its workflow", async () => {
    const validToken = jwt.sign({ userId: "user-attacker" }, config.JWT_SECRET);
    mockPrisma.workflowRun.findUnique.mockResolvedValue({
      id: "run-123",
      userId: "user-victim",
      workflow: {
        userId: "user-victim",
        organizationId: null,
      },
    });

    const res = await request(app).get(`/api/runs/run-123/stream?token=${validToken}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("FORBIDDEN");
  });

  it("allows access and sets SSE headers when the user owns the run", async () => {
    const validToken = jwt.sign({ userId: "user-owner" }, config.JWT_SECRET);
    mockPrisma.workflowRun.findUnique.mockResolvedValue({
      id: "run-123",
      userId: "user-owner",
      workflow: {
        userId: "user-owner",
        organizationId: null,
      },
    });

    const res = await request(app)
      .get(`/api/runs/run-123/stream?token=${validToken}`)
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
          // Abort after receiving initial connection message
          if (data.includes("connected")) {
            if (typeof (res as any).destroy === "function") {
              (res as any).destroy();
            }
            cb(null, data);
          }
        });
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: connected");
  });

  it("allows access when the user is a member of the workflow organization", async () => {
    const validToken = jwt.sign({ userId: "org-member-1" }, config.JWT_SECRET);
    mockPrisma.workflowRun.findUnique.mockResolvedValue({
      id: "run-123",
      userId: "other-user",
      workflow: {
        userId: "other-user",
        organizationId: "org-100",
      },
    });
    mockPrisma.organizationMember.findUnique.mockResolvedValue({
      id: "mem-1",
      organizationId: "org-100",
      userId: "org-member-1",
    });

    const res = await request(app)
      .get(`/api/runs/run-123/stream?token=${validToken}`)
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
          if (data.includes("connected")) {
            if (typeof (res as any).destroy === "function") {
              (res as any).destroy();
            }
            cb(null, data);
          }
        });
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: connected");
  });

  it("returns 403 FORBIDDEN when user ran an org workflow but was removed from the organization", async () => {
    const validToken = jwt.sign({ userId: "ex-member-runner" }, config.JWT_SECRET);
    mockPrisma.workflowRun.findUnique.mockResolvedValue({
      id: "run-123",
      userId: "ex-member-runner",
      workflow: {
        userId: "org-owner",
        organizationId: "org-100",
      },
    });
    // Membership lookup returns null (user was removed from org)
    mockPrisma.organizationMember.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/runs/run-123/stream?token=${validToken}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("FORBIDDEN");
  });
});
