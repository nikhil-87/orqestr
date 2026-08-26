import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { prisma } from "./config/prisma.config";
import { logger } from "./config/logger.config";
import config from "./config";
import { JobQueue } from "./queues";
import { AgentRegistry } from "./agents/registry";
import { Orchestrator } from "./orchestrator";
import { createApiRoutes } from "./api";
import { swaggerRouter } from "./swagger";
import { errorHandlerMiddleware } from "./middleware/error.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { SchedulerWorker } from "./api/scheduler/scheduler.worker";
import { SchedulerService } from "./api/scheduler/scheduler.service";
import { SchedulerRepository } from "./api/scheduler/scheduler.repository";
import { WorkflowRepository } from "./api/workflow/workflow.repository";

dotenv.config();

const app = express();

const clientOrigin = config.CLIENT_URL ? config.CLIENT_URL.replace(/\/+$/, "") : "";

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  clientOrigin,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      const normalized = origin.replace(/\/+$/, "");
      if (
        allowedOrigins.has(normalized) ||
        normalized === clientOrigin ||
        normalized.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  }),
);
// Initialize orchestrator & scheduler
const orchestrator = new Orchestrator(prisma);
const schedulerWorker = new SchedulerWorker(orchestrator);
const schedulerService = new SchedulerService(
  new SchedulerRepository(prisma),
  new WorkflowRepository(prisma),
);

const start = async (): Promise<void> => {
  try {
    // Verify database connection
    await prisma.$connect();
    logger.success("Database connected successfully");

    // Start agents
    await AgentRegistry.startAgents();

    // Start orchestrator
    await orchestrator.start();
    logger.success("Orchestrator started successfully");

    // Start scheduler worker and sync existing schedules
    schedulerWorker.start();
    await schedulerService.syncAllSchedules();
    logger.success("Scheduler service initialized and synced");

    // Wire in the middleware and routes
    app.use(express.json());
    app.use(cookieParser());
    app.use(requestLogger);

    app.get("/health", (_, res) => {
      res.json({ status: "ok" });
    });

    app.use("/api/docs", swaggerRouter);
    app.use(createApiRoutes(orchestrator, prisma));
    app.use(errorHandlerMiddleware);

    // Start Express server
    const PORT = process.env.PORT || 8000;
    app.listen(PORT, () => {
      logger.success(`Server running on port ${PORT}`);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error(`Failed to start server: ${errorMessage}`);

    process.exit(1);
  }
};

const shutdown = async (): Promise<void> => {
  logger.info("Shutting down server...");

  try {
    // Stop in reverse order of startup
    await schedulerWorker.stop();
    logger.success("Scheduler worker stopped");

    await orchestrator.stop();
    logger.success("Orchestrator stopped");

    await AgentRegistry.stopAgents();

    await JobQueue.closeAllQueues();
    logger.success("All queues closed");

    await prisma.$disconnect();
    logger.success("Database disconnected");

    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error(`Error during shutdown: ${errorMessage}`);

    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
