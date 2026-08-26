import { OrganizationMember, Prisma, PrismaClient, WorkflowDefinition, WorkflowVersion } from "@prisma/client";

export class WorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrgMembership(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    return await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async findAllByUser(userId: string, organizationId?: string): Promise<WorkflowDefinition[]> {
    if (organizationId) {
      return await this.prisma.workflowDefinition.findMany({
        where: { organizationId, isArchived: false },
        orderBy: { updatedAt: "desc" },
      });
    }

    return await this.prisma.workflowDefinition.findMany({
      where: { userId, organizationId: null, isArchived: false },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findById(id: string): Promise<WorkflowDefinition | null> {
    return await this.prisma.workflowDefinition.findUnique({
      where: {
        id,
      },
    });
  }

  async create(
    data: {
      name: string;
      description?: string;
      definition: Prisma.InputJsonValue;
      organizationId?: string;
    },
    userId: string,
  ): Promise<WorkflowDefinition> {
    return await this.prisma.workflowDefinition.create({
      data: {
        name: data.name,
        description: data.description,
        definition: data.definition,
        userId,
        organizationId: data.organizationId ?? null,
      },
    });
  }

  async update(
    id: string,
    data: Prisma.WorkflowDefinitionUpdateInput,
  ): Promise<WorkflowDefinition> {
    return await this.prisma.workflowDefinition.update({
      where: {
        id,
      },
      data: data,
    });
  }

  async delete(id: string): Promise<WorkflowDefinition> {
    await this.prisma.workflowSchedule.deleteMany({ where: { workflowId: id } });
    await this.prisma.webhook.deleteMany({ where: { workflowId: id } });
    return await this.prisma.workflowDefinition.update({
      where: {
        id,
      },
      data: {
        isArchived: true,
      },
    });
  }

  // ── Versioning ─────────────────────────────────────────────────────────────

  async createVersion(data: {
    workflowId: string;
    version: number;
    name: string;
    description?: string | null;
    definition: Prisma.InputJsonValue;
  }): Promise<WorkflowVersion> {
    return await this.prisma.workflowVersion.create({
      data: {
        workflowId: data.workflowId,
        version: data.version,
        name: data.name,
        description: data.description ?? null,
        definition: data.definition,
      },
    });
  }

  async findVersionsByWorkflowId(workflowId: string): Promise<WorkflowVersion[]> {
    return await this.prisma.workflowVersion.findMany({
      where: { workflowId },
      orderBy: { version: "desc" },
    });
  }

  async findVersion(workflowId: string, version: number): Promise<WorkflowVersion | null> {
    return await this.prisma.workflowVersion.findUnique({
      where: {
        workflowId_version: {
          workflowId,
          version,
        },
      },
    });
  }
}
