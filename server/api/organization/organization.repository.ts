import { OrgRole, PrismaClient, Organization, OrganizationMember } from "@prisma/client";

export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: { name: string; slug: string },
    ownerUserId: string,
  ): Promise<Organization> {
    return await this.prisma.organization.create({
      data: {
        name: data.name,
        slug: data.slug,
        members: {
          create: {
            userId: ownerUserId,
            role: OrgRole.OWNER,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async findById(id: string): Promise<Organization | null> {
    return await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return await this.prisma.organization.findUnique({
      where: { slug },
    });
  }

  async findUserOrganizations(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return memberships.map((m) => m.organization);
  }

  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    return await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async findMembers(organizationId: string): Promise<OrganizationMember[]> {
    return await this.prisma.organizationMember.findMany({
      where: { organizationId },
    });
  }

  async countOwners(organizationId: string): Promise<number> {
    return await this.prisma.organizationMember.count({
      where: {
        organizationId,
        role: OrgRole.OWNER,
      },
    });
  }

  async addMember(
    organizationId: string,
    userId: string,
    role: OrgRole = OrgRole.MEMBER,
  ): Promise<OrganizationMember> {
    return await this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrganizationMember> {
    return await this.prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  async removeMember(organizationId: string, userId: string): Promise<OrganizationMember> {
    return await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; slug?: string },
  ): Promise<Organization> {
    return await this.prisma.organization.update({
      where: { id },
      data,
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async delete(id: string): Promise<Organization> {
    return await this.prisma.organization.delete({
      where: { id },
    });
  }
}
