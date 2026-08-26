import { OrgRole, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError, ConflictError, ApiError } from "../../utils/errors";
import { OrganizationRepository } from "./organization.repository";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class OrganizationService {
  constructor(
    private readonly orgRepository: OrganizationRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async createOrganization(
    data: { name: string; slug?: string },
    userId: string,
  ) {
    const { name } = data;
    if (!name || name.trim() === "") {
      throw new ValidationError("Organization name is required");
    }

    let slug = data.slug ? slugify(data.slug) : slugify(name);
    if (!slug) {
      slug = `org-${Date.now()}`;
    }

    const existing = await this.orgRepository.findBySlug(slug);
    if (existing) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    return await this.orgRepository.create({ name, slug }, userId);
  }

  async getOrganization(orgId: string, userId: string) {
    if (!orgId) throw new ValidationError("Organization ID is required");

    const membership = await this.orgRepository.findMembership(orgId, userId);
    if (!membership) {
      throw new ApiError("You do not have access to this organization", 403, "FORBIDDEN");
    }

    const org = await this.orgRepository.findById(orgId);
    if (!org) throw new NotFoundError("Organization", orgId);

    return org;
  }

  async getUserOrganizations(userId: string) {
    return await this.orgRepository.findUserOrganizations(userId);
  }

  async addMember(
    orgId: string,
    data: { userId?: string; email?: string; role?: OrgRole },
    requesterUserId: string,
  ) {
    if (!orgId) throw new ValidationError("Organization ID is required");

    const requesterMembership = await this.orgRepository.findMembership(orgId, requesterUserId);
    if (!requesterMembership || (requesterMembership.role !== OrgRole.OWNER && requesterMembership.role !== OrgRole.ADMIN)) {
      throw new ApiError("Only organization owners and admins can add members", 403, "FORBIDDEN");
    }

    let targetUserId = data.userId;

    if (!targetUserId && data.email) {
      const user = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (!user) {
        throw new NotFoundError("User with email", data.email);
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      throw new ValidationError("Either userId or email is required to add member");
    }

    const existingMember = await this.orgRepository.findMembership(orgId, targetUserId);
    if (existingMember) {
      throw new ConflictError("User is already a member of this organization");
    }

    const newMember = await this.orgRepository.addMember(orgId, targetUserId, data.role ?? OrgRole.MEMBER);

    // Create in-app notification for the invited user
    try {
      const org = await this.orgRepository.findById(orgId);
      const requester = await this.prisma.user.findUnique({ where: { id: requesterUserId } });
      if (org && requester) {
        await this.prisma.notification.create({
          data: {
            userId: targetUserId,
            title: "Added to Workspace",
            message: `${requester.name} added you to ${org.name} as ${data.role ?? OrgRole.MEMBER}`,
            type: "WORKSPACE_INVITE",
            organizationId: orgId,
            metadata: {
              organizationId: orgId,
              organizationName: org.name,
              role: data.role ?? OrgRole.MEMBER,
              actorName: requester.name,
              actorEmail: requester.email,
            },
          },
        });
      }
    } catch {
      // Non-fatal notification error
    }

    return newMember;
  }

  async updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string },
    requesterUserId: string,
  ) {
    if (!orgId) throw new ValidationError("Organization ID is required");

    const requesterMembership = await this.orgRepository.findMembership(orgId, requesterUserId);
    if (!requesterMembership || (requesterMembership.role !== OrgRole.OWNER && requesterMembership.role !== OrgRole.ADMIN)) {
      throw new ApiError("Only organization owners and admins can update workspace settings", 403, "FORBIDDEN");
    }

    const updates: { name?: string; slug?: string } = {};
    if (data.name !== undefined) {
      if (!data.name || data.name.trim() === "") {
        throw new ValidationError("Organization name cannot be empty");
      }
      updates.name = data.name.trim();
    }

    if (data.slug !== undefined) {
      const slug = slugify(data.slug);
      if (!slug) throw new ValidationError("Valid slug is required");
      const existing = await this.orgRepository.findBySlug(slug);
      if (existing && existing.id !== orgId) {
        throw new ConflictError("Organization slug is already in use");
      }
      updates.slug = slug;
    }

    return await this.orgRepository.update(orgId, updates);
  }

  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    newRole: OrgRole,
    requesterUserId: string,
  ) {
    if (!orgId) throw new ValidationError("Organization ID is required");
    if (!targetUserId) throw new ValidationError("Target user ID is required");

    const requesterMembership = await this.orgRepository.findMembership(orgId, requesterUserId);
    if (!requesterMembership || requesterMembership.role !== OrgRole.OWNER) {
      throw new ApiError("Only organization owners can change member roles", 403, "FORBIDDEN");
    }

    const targetMembership = await this.orgRepository.findMembership(orgId, targetUserId);
    if (!targetMembership) {
      throw new NotFoundError("Member", targetUserId);
    }

    const updated = await this.orgRepository.updateMemberRole(orgId, targetUserId, newRole);

    // Create in-app notification for the member whose role changed
    try {
      const org = await this.orgRepository.findById(orgId);
      const requester = await this.prisma.user.findUnique({ where: { id: requesterUserId } });
      if (org && requester) {
        await this.prisma.notification.create({
          data: {
            userId: targetUserId,
            title: "Workspace Role Updated",
            message: `${requester.name} updated your role in ${org.name} to ${newRole}`,
            type: "WORKSPACE_ROLE_CHANGE",
            organizationId: orgId,
            metadata: {
              organizationId: orgId,
              organizationName: org.name,
              role: newRole,
              actorName: requester.name,
              actorEmail: requester.email,
            },
          },
        });
      }
    } catch {
      // Non-fatal notification error
    }

    return updated;
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    requesterUserId: string,
  ) {
    if (!orgId) throw new ValidationError("Organization ID is required");
    if (!targetUserId) throw new ValidationError("Target user ID is required");

    const requesterMembership = await this.orgRepository.findMembership(orgId, requesterUserId);
    if (!requesterMembership) {
      throw new ApiError("You do not belong to this organization", 403, "FORBIDDEN");
    }

    const isSelf = requesterUserId === targetUserId;
    const isOwnerOrAdmin = requesterMembership.role === OrgRole.OWNER || requesterMembership.role === OrgRole.ADMIN;

    if (!isSelf && !isOwnerOrAdmin) {
      throw new ApiError("You do not have permission to remove this member", 403, "FORBIDDEN");
    }

    const targetMembership = await this.orgRepository.findMembership(orgId, targetUserId);
    if (!targetMembership) {
      throw new NotFoundError("Member", targetUserId);
    }

    if (targetMembership.role === OrgRole.OWNER) {
      const ownerCount = await this.orgRepository.countOwners(orgId);
      if (ownerCount <= 1) {
        throw new ValidationError("Cannot remove the only owner of an organization");
      }
    }

    return await this.orgRepository.removeMember(orgId, targetUserId);
  }

  async deleteOrganization(orgId: string, requesterUserId: string) {
    if (!orgId) throw new ValidationError("Organization ID is required");

    const requesterMembership = await this.orgRepository.findMembership(orgId, requesterUserId);
    if (!requesterMembership || requesterMembership.role !== OrgRole.OWNER) {
      throw new ApiError("Only organization owners can delete the organization", 403, "FORBIDDEN");
    }

    return await this.orgRepository.delete(orgId);
  }
}
