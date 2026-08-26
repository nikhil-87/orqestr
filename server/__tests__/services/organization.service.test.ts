import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrganizationService } from "../../api/organization/organization.service";
import { OrganizationRepository } from "../../api/organization/organization.repository";
import { OrgRole, PrismaClient } from "@prisma/client";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "../../utils/errors";

function createMockOrgRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findUserOrganizations: vi.fn(),
    findMembership: vi.fn(),
    countOwners: vi.fn(),
    addMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    delete: vi.fn(),
  } as unknown as OrganizationRepository;
}

describe("OrganizationService", () => {
  let orgRepo: ReturnType<typeof createMockOrgRepo>;
  let mockPrisma: any;
  let service: OrganizationService;

  const mockOrg = {
    id: "org-1",
    name: "Acme Corp",
    slug: "acme-corp",
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [{ userId: "owner-1", role: OrgRole.OWNER }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    orgRepo = createMockOrgRepo();
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
      },
    };
    service = new OrganizationService(orgRepo, mockPrisma as PrismaClient);
  });

  describe("createOrganization", () => {
    it("creates organization and owner membership", async () => {
      (orgRepo.findBySlug as any).mockResolvedValue(null);
      (orgRepo.create as any).mockResolvedValue(mockOrg);

      const result = await service.createOrganization(
        { name: "Acme Corp" },
        "owner-1",
      );

      expect(orgRepo.create).toHaveBeenCalledWith(
        { name: "Acme Corp", slug: "acme-corp" },
        "owner-1",
      );
      expect(result.name).toBe("Acme Corp");
    });

    it("throws ValidationError if name is empty", async () => {
      await expect(service.createOrganization({ name: "" }, "owner-1")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("addMember", () => {
    it("adds member when requester is OWNER or ADMIN", async () => {
      (orgRepo.findMembership as any).mockImplementation((_orgId: string, userId: string) => {
        if (userId === "owner-1") return Promise.resolve({ role: OrgRole.OWNER });
        return Promise.resolve(null); // target user not yet a member
      });
      (orgRepo.addMember as any).mockResolvedValue({
        id: "mem-2",
        organizationId: "org-1",
        userId: "user-2",
        role: OrgRole.MEMBER,
      });

      const result = await service.addMember(
        "org-1",
        { userId: "user-2", role: OrgRole.MEMBER },
        "owner-1",
      );

      expect(orgRepo.addMember).toHaveBeenCalledWith("org-1", "user-2", OrgRole.MEMBER);
      expect(result.userId).toBe("user-2");
    });

    it("throws ApiError(403) when requester is regular MEMBER", async () => {
      (orgRepo.findMembership as any).mockResolvedValue({ role: OrgRole.MEMBER });

      await expect(
        service.addMember("org-1", { userId: "user-2" }, "member-1"),
      ).rejects.toThrow(ApiError);
    });

    it("throws ConflictError when user is already a member", async () => {
      (orgRepo.findMembership as any).mockImplementation((_orgId: string, userId: string) => {
        if (userId === "owner-1") return Promise.resolve({ role: OrgRole.OWNER });
        if (userId === "user-2") return Promise.resolve({ role: OrgRole.MEMBER });
        return Promise.resolve(null);
      });

      await expect(
        service.addMember("org-1", { userId: "user-2" }, "owner-1"),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("removeMember", () => {
    it("prevents removing the last owner", async () => {
      (orgRepo.findMembership as any).mockImplementation((_orgId: string, userId: string) => {
        if (userId === "owner-1") return Promise.resolve({ role: OrgRole.OWNER });
        return Promise.resolve(null);
      });
      (orgRepo.countOwners as any).mockResolvedValue(1);

      await expect(
        service.removeMember("org-1", "owner-1", "owner-1"),
      ).rejects.toThrow(ValidationError);
    });
  });
});
