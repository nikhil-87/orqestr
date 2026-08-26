import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { runEmitter } from "../../events/run.emitter";
import { logger } from "../../config/logger.config";
import config from "../../config";

export const createSseHandler = (prisma?: PrismaClient) => {
  let db: PrismaClient;
  return async (req: Request, res: Response) => {
    if (!db) {
      db = prisma || new PrismaClient();
    }
    const runId = (Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId) as string;
    if (!runId) {
      res.status(400).json({ success: false, message: "Run ID is required" });
      return;
    }

    // Extract token from query parameter or Authorization header
    const tokenQuery = typeof req.query.token === "string" ? req.query.token : undefined;
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (tokenQuery) {
      token = tokenQuery;
    } else if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Authentication required for SSE stream",
        errorCode: "UNAUTHORIZED",
      });
      return;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };
      userId = decoded.userId;
    } catch {
      res.status(401).json({
        success: false,
        message: "Invalid or expired token",
        errorCode: "UNAUTHORIZED",
      });
      return;
    }

    // Verify run exists and check ownership
    const workflowRun = (await db.workflowRun.findUnique({
      where: { id: runId },
      include: {
        workflow: true,
      },
    })) as any;

    if (!workflowRun) {
      res.status(404).json({
        success: false,
        message: "Workflow run not found",
        errorCode: "NOT_FOUND",
      });
      return;
    }

    // Check access: for organization workflows, active organization membership is required;
    // for personal workflows, user must be the run creator or workflow owner.
    let hasAccess = false;
    if (workflowRun.workflow?.organizationId) {
      const membership = await db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: workflowRun.workflow.organizationId,
            userId,
          },
        },
      });
      if (membership) {
        hasAccess = true;
      }
    } else {
      if (workflowRun.userId === userId || workflowRun.workflow?.userId === userId) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      res.status(403).json({
        success: false,
        message: "You do not have access to this workflow run stream",
        errorCode: "FORBIDDEN",
      });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    // Initial connection event
    res.write("event: connected\n");
    res.write(
      `data: ${JSON.stringify({
        message: "Connection established successfully",
        runId,
      })}\n\n`,
    );

    // Event listener
    const eventListener = (eventData: unknown) => {
      res.write("event: workflow-update\n");
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };

    // Subscribe to events
    runEmitter.on(`run:${runId}`, eventListener);

    // Cleanup on disconnect
    req.on("close", () => {
      logger.debug(`SSE client disconnected for runID: ${runId}`);
      runEmitter.off(`run:${runId}`, eventListener);
      res.end();
    });
  };
};

export const handleWorkflowRunServerSentEvents = createSseHandler();
