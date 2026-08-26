import { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis.config";
import { ApiError } from "../utils/errors";
import { logger } from "../config/logger.config";

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  message?: string;
}

export function createRedisRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    maxRequests,
    keyPrefix,
    message = "Too many requests, please try again later.",
  } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Identify client by IP
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const key = `${keyPrefix}:${clientIp}`;

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      const ttl = await redis.ttl(key);

      res.setHeader("X-RateLimit-Limit", maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - current).toString());
      res.setHeader("X-RateLimit-Reset", Math.max(0, ttl).toString());

      if (current > maxRequests) {
        res.setHeader("Retry-After", Math.max(1, ttl).toString());
        throw new ApiError(message, 429, "RATE_LIMIT_EXCEEDED");
      }

      next();
    } catch (err: any) {
      if (err instanceof ApiError) {
        return next(err);
      }
      // If Redis fails, log warning and fail-open so legitimate users aren't locked out
      logger.warn(`Rate limiter Redis error: ${err.message}`);
      next();
    }
  };
}
