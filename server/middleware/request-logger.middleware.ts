import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../config/logger.config";
import { sanitizeString } from "../utils/log-sanitizer";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID().slice(0, 8);
  req.id = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const cleanUrl = sanitizeString(req.originalUrl || req.path);

    logger.info(`[${req.method}] ${cleanUrl} ${statusCode} ${duration}ms [req:${requestId}]`);
  });

  next();
};
