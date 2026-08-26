import { Prisma, PrismaClient, WorkflowSchedule } from "@prisma/client";

export class SchedulerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByWorkflowId(workflowId: string): Promise<WorkflowSchedule | null> {
    return await this.prisma.workflowSchedule.findUnique({
      where: { workflowId },
    });
  }

  async findById(id: string): Promise<WorkflowSchedule | null> {
    return await this.prisma.workflowSchedule.findUnique({
      where: { id },
    });
  }

  async findAllEnabled(): Promise<WorkflowSchedule[]> {
    return await this.prisma.workflowSchedule.findMany({
      where: { enabled: true },
    });
  }

  async create(data: {
    workflowId: string;
    userId: string;
    cronExpression: string;
    timezone?: string;
    input?: Prisma.InputJsonValue;
    enabled?: boolean;
  }): Promise<WorkflowSchedule> {
    return await this.prisma.workflowSchedule.create({
      data: {
        workflowId: data.workflowId,
        userId: data.userId,
        cronExpression: data.cronExpression,
        timezone: data.timezone ?? "UTC",
        input: data.input ?? {},
        enabled: data.enabled ?? true,
      },
    });
  }

  async update(
    workflowId: string,
    data: Prisma.WorkflowScheduleUpdateInput,
  ): Promise<WorkflowSchedule> {
    return await this.prisma.workflowSchedule.update({
      where: { workflowId },
      data,
    });
  }

  async delete(workflowId: string): Promise<WorkflowSchedule> {
    return await this.prisma.workflowSchedule.delete({
      where: { workflowId },
    });
  }

  async updateLastRun(workflowId: string, lastRunAt: Date): Promise<void> {
    await this.prisma.workflowSchedule.update({
      where: { workflowId },
      data: { lastRunAt },
    });
  }
}
