import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createApiRoutes } from "../../api";
import { swaggerRouter } from "../../swagger";
import { errorHandlerMiddleware } from "../../middleware/error.middleware";

export function createTestApp(orchestrator: unknown, prisma: unknown) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/docs", swaggerRouter);
  app.use(createApiRoutes(orchestrator as any, prisma as any));

  app.use(errorHandlerMiddleware);

  return app;
}

export function generateTestToken(userId = "test-user-id"): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: "15m" });
}
