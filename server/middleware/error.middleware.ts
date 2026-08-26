import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/errors";
import { logger } from "../config/logger.config";
import { sanitizeString } from "../utils/log-sanitizer";

export const errorHandlerMiddleware = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  const reqTag = req.id ? `[req:${req.id}] ` : "";
  const cleanPath = sanitizeString(req.originalUrl || req.path);

  if (err instanceof ApiError) {
    logger.warn(`${reqTag}[${req.method}] ${cleanPath} - ${err.message} (${err.statusCode})`);

    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode,
    });
  }

  // 500 Unhandled Exceptions: Log error with sanitized stack trace for debugging
  const errorMessage = err?.message || "Unknown error";
  const errorStack = err?.stack || "";

  logger.error(
    `${reqTag}[${req.method}] ${cleanPath} - ${errorMessage}\n${errorStack}`.trim(),
  );

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    errorCode: "INTERNAL_SERVER_ERROR",
    ...(req.id ? { requestId: req.id } : {}),
  });
};
