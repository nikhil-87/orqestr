import { PrismaClient, AgentStatus, RunStatus } from "@prisma/client";

export class DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getStats(userId: string, organizationId?: string) {
    const workflowWhere = organizationId
      ? { organizationId, isArchived: false }
      : { userId, organizationId: null, isArchived: false };

    const runWhere = organizationId
      ? { workflow: { organizationId } }
      : { workflow: { userId, organizationId: null } };

    const completedRunWhere = organizationId
      ? { workflow: { organizationId }, status: RunStatus.COMPLETED }
      : {
          workflow: { userId, organizationId: null },
          status: RunStatus.COMPLETED,
        };

    const [totalWorkflows, totalRuns, completedRuns, agentsOnline] = await Promise.all([
      this.prisma.workflowDefinition.count({ where: workflowWhere }),
      this.prisma.workflowRun.count({ where: runWhere }),
      this.prisma.workflowRun.count({ where: completedRunWhere }),
      this.prisma.agent.count({
        where: { status: AgentStatus.ONLINE },
      }),
    ]);

    return {
      totalWorkflows,
      totalRuns,
      completedRuns,
      agentsOnline,
    };
  }

  async getRecentRuns(userId: string, organizationId?: string) {
    const runWhere = organizationId
      ? { workflow: { organizationId } }
      : { workflow: { userId, organizationId: null } };

    return await this.prisma.workflowRun.findMany({
      where: runWhere,
      take: 5,
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        workflow: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    });
  }
}
