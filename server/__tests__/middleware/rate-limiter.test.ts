import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createRedisRateLimiter } from "../../middleware/rate-limiter.middleware";
import { redis } from "../../config/redis.config";

describe("createRedisRateLimiter Middleware", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it("allows requests under the rate limit threshold", async () => {
    (redis.incr as any).mockResolvedValueOnce(1);
    (redis.expire as any).mockResolvedValueOnce("OK");
    (redis.ttl as any).mockResolvedValueOnce(60);

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
      keyPrefix: "rl:test:allow",
    });

    app.get("/test-rate", limiter, (_req, res) => {
      res.status(200).json({ success: true });
    });

    const res = await request(app).get("/test-rate");

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe("5");
    expect(res.headers["x-ratelimit-remaining"]).toBe("4");
    expect(res.headers["x-ratelimit-reset"]).toBe("60");
  });

  it("blocks requests exceeding the threshold with 429 and Retry-After header", async () => {
    (redis.incr as any).mockResolvedValueOnce(6); // 6th request against limit of 5
    (redis.ttl as any).mockResolvedValueOnce(45);

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
      keyPrefix: "rl:test:block",
      message: "Custom rate limit message",
    });

    app.get("/test-block", limiter, (_req, res) => {
      res.status(200).json({ success: true });
    });

    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        errorCode: err.errorCode,
      });
    });

    const res = await request(app).get("/test-block");

    expect(res.status).toBe(429);
    expect(res.body.message).toContain("Custom rate limit message");
    expect(res.headers["retry-after"]).toBe("45");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("fails open gracefully and allows traffic if Redis encounters an error", async () => {
    (redis.incr as any).mockRejectedValueOnce(new Error("Redis connection timed out"));

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
      keyPrefix: "rl:test:failopen",
    });

    app.get("/test-failopen", limiter, (_req, res) => {
      res.status(200).json({ success: true, fromFailOpen: true });
    });

    const res = await request(app).get("/test-failopen");

    expect(res.status).toBe(200);
    expect(res.body.fromFailOpen).toBe(true);
  });
});
