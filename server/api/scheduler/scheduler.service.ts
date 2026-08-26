import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError, ConflictError } from "../../utils/errors";
import { SchedulerRepository } from "./scheduler.repository";
import { WorkflowRepository } from "../workflow/workflow.repository";
import { schedulerQueue } from "./scheduler.worker";
import { logger } from "../../config/logger.config";

// Basic cron pattern validator (standard 5 fields: minute hour dom month dow)
function isValidCron(cron: string): boolean {
  if (!cron || typeof cron !== "string") return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const cronSegmentRegex = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?)(,(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?))*$/;
  return parts.every((part) => cronSegmentRegex.test(part));
}

export class SchedulerService {
  constructor(
    private readonly schedulerRepository: SchedulerRepository,
    private readonly workflowRepository: WorkflowRepository,
  ) {}

  private async canAccess(
    workflow: { userId: string | null; organizationId: string | null },
    userId: string,
    organizationId?: string,
  ): Promise<boolean> {
    if (workflow.organizationId) {
      if (organizationId && organizationId !== workflow.organizationId) {
        return false;
      }
      const membership = await this.workflowRepository.findOrgMembership(
        workflow.organizationId,
        userId,
      );
      return membership !== null;
    }

    if (organizationId) {
      return false;
    }

    return workflow.userId === userId;
  }

  public async removeRepeatableJob(workflowId: string): Promise<void> {
    try {
      const repeatables = await schedulerQueue.getRepeatableJobs();
      const target = repeatables.find((j) => j.name === `schedule:${workflowId}`);
      if (target) {
        await schedulerQueue.removeRepeatableByKey(target.key);
      }
    } catch (err) {
      logger.warn(`Failed to remove repeatable job for workflow ${workflowId}: ${err}`);
    }
  }

  private async registerRepeatableJob(
    workflowId: string,
    cronExpression: string,
    timezone: string,
    input: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    await this.removeRepeatableJob(workflowId);

    await schedulerQueue.add(
      `schedule:${workflowId}`,
      { workflowId, userId, input },
      {
        repeat: {
          pattern: cronExpression,
          tz: timezone || "UTC",
        },
        jobId: `schedule:${workflowId}`,
      },
    );
  }

  async getSchedule(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const schedule = await this.schedulerRepository.findByWorkflowId(workflowId);
    if (!schedule) throw new NotFoundError("WorkflowSchedule", workflowId);

    return schedule;
  }

  async createSchedule(
    workflowId: string,
    data: {
      cronExpression: string;
      timezone?: string;
      input?: Record<string, unknown>;
      enabled?: boolean;
    },
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");
    const { cronExpression, timezone = "UTC", input = {}, enabled = true } = data;

    if (!cronExpression || !isValidCron(cronExpression)) {
      throw new ValidationError(`Invalid cron expression: "${cronExpression}"`);
    }

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const existing = await this.schedulerRepository.findByWorkflowId(workflowId);
    if (existing) {
      throw new ConflictError("A schedule already exists for this workflow. Use update instead.");
    }

    const schedule = await this.schedulerRepository.create({
      workflowId,
      userId,
      cronExpression,
      timezone,
      input: input as Prisma.InputJsonValue,
      enabled,
    });

    if (enabled) {
      await this.registerRepeatableJob(workflowId, cronExpression, timezone, input, userId);
    }

    return schedule;
  }

  async updateSchedule(
    workflowId: string,
    data: {
      cronExpression?: string;
      timezone?: string;
      input?: Record<string, unknown>;
      enabled?: boolean;
    },
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const current = await this.schedulerRepository.findByWorkflowId(workflowId);
    if (!current) throw new NotFoundError("WorkflowSchedule", workflowId);

    if (data.cronExpression && !isValidCron(data.cronExpression)) {
      throw new ValidationError(`Invalid cron expression: "${data.cronExpression}"`);
    }

    const cronExpression = data.cronExpression ?? current.cronExpression;
    const timezone = data.timezone ?? current.timezone;
    const input = (data.input ?? current.input) as Record<string, unknown>;
    const enabled = data.enabled !== undefined ? data.enabled : current.enabled;

    const updated = await this.schedulerRepository.update(workflowId, {
      cronExpression,
      timezone,
      input: input as Prisma.InputJsonValue,
      enabled,
    });

    if (enabled) {
      await this.registerRepeatableJob(workflowId, cronExpression, timezone, input, userId);
    } else {
      await this.removeRepeatableJob(workflowId);
    }

    return updated;
  }

  async deleteSchedule(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const current = await this.schedulerRepository.findByWorkflowId(workflowId);
    if (!current) throw new NotFoundError("WorkflowSchedule", workflowId);

    await this.removeRepeatableJob(workflowId);
    return await this.schedulerRepository.delete(workflowId);
  }

  async toggleSchedule(
    workflowId: string,
    enabled: boolean,
    userId: string,
    organizationId?: string,
  ) {
    return await this.updateSchedule(workflowId, { enabled }, userId, organizationId);
  }

  async syncAllSchedules(): Promise<void> {
    try {
      const enabledSchedules = await this.schedulerRepository.findAllEnabled();
      logger.info(`Syncing ${enabledSchedules.length} enabled schedules to BullMQ...`);

      for (const sched of enabledSchedules) {
        await this.registerRepeatableJob(
          sched.workflowId,
          sched.cronExpression,
          sched.timezone,
          sched.input as Record<string, unknown>,
          sched.userId,
        );
      }
      logger.success("All enabled schedules synced to BullMQ");
    } catch (error) {
      logger.error(`Error syncing schedules on startup: ${error}`);
    }
  }
}
