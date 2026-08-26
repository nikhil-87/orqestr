import { PrismaClient, WorkflowRun } from "@prisma/client";

export class WorkflowRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrgMembership(organizationId: string, userId: string) {
    return await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async findAllByUser(userId: string, organizationId?: string): Promise<WorkflowRun[]> {
    if (organizationId) {
      return await this.prisma.workflowRun.findMany({
        where: {
          workflow: {
            organizationId,
          },
        },
        include: {
          tasks: true,
          workflow: true,
        },
        orderBy: { startedAt: "desc" },
      });
    }

    return await this.prisma.workflowRun.findMany({
      where: {
        workflow: {
          organizationId: null,
          userId,
        },
      },
      include: {
        tasks: true,
        workflow: true,
      },
      orderBy: { startedAt: "desc" },
    });
  }

  async findById(id: string): Promise<WorkflowRun | null> {
    return await this.prisma.workflowRun.findUnique({
      where: {
        id,
      },
      include: {
        tasks: true,
        workflow: true,
      },
    });
  }

  async findByWorkflowId(workflowId: string): Promise<WorkflowRun[]> {
    return await this.prisma.workflowRun.findMany({
      where: {
        workflowId,
      },
      include: {
        tasks: true,
        workflow: true,
      },
      orderBy: { startedAt: "desc" },
    });
  }

  async cancelRun(id: string): Promise<WorkflowRun> {
    const [updatedRun] = await this.prisma.$transaction([
      this.prisma.workflowRun.update({
        where: { id },
        data: {
          status: "CANCELLED",
          error: "Workflow run cancelled by user",
          completedAt: new Date(),
        },
        include: {
          tasks: true,
          workflow: true,
        },
      }),
      this.prisma.task.updateMany({
        where: {
          runId: id,
          status: "PENDING",
        },
        data: {
          status: "CANCELLED",
        },
      }),
    ]);
    return updatedRun;
  }
}
