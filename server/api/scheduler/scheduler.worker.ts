import { Job, Queue, Worker } from "bullmq";
import { redis } from "../../config/redis.config";
import { logger } from "../../config/logger.config";
import { Orchestrator } from "../../orchestrator";
import { SchedulerRepository } from "./scheduler.repository";
import { prisma } from "../../config/prisma.config";

export const SCHEDULER_QUEUE_NAME = "WORKFLOW_SCHEDULER";

export const schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export class SchedulerWorker {
  private worker: Worker | null = null;
  private repository: SchedulerRepository;

  constructor(private readonly orchestrator: Orchestrator) {
    this.repository = new SchedulerRepository(prisma);
  }

  start() {
    if (this.worker) return;

    this.worker = new Worker(
      SCHEDULER_QUEUE_NAME,
      async (job: Job) => {
        const { workflowId, userId, input } = job.data;

        logger.info(`Cron trigger executing for workflow: ${workflowId}`);

        try {
          // Verify workflow is still present and schedule is still enabled
          const schedule = await this.repository.findByWorkflowId(workflowId);
          if (!schedule || !schedule.enabled) {
            logger.warn(`Cron trigger skipped — schedule not found or disabled: ${workflowId}`);
            return;
          }

          const run = await this.orchestrator.triggerRun(workflowId, input || {}, userId);
          await this.repository.updateLastRun(workflowId, new Date());

          logger.success(`Cron triggered run started: ${run.runId} for workflow: ${workflowId}`);
        } catch (error) {
          const err = error instanceof Error ? error.message : "Unknown error";
          logger.error(`Cron trigger failed for workflow ${workflowId}: ${err}`);
        }
      },
      { connection: redis },
    );

    this.worker.on("error", (err) => {
      logger.error(`Scheduler worker error: ${err.message}`);
    });

    logger.info("Scheduler worker started");
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      logger.info("Scheduler worker stopped");
    }
  }
}
