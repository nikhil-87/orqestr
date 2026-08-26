import { OrganizationService } from "./organization.service";
import { BodyController, BodyParamsController, Controller, ParamsController } from "../../utils/types";
import { OrgRole } from "@prisma/client";

type orgParams = {
  id: string;
};

type memberParams = {
  id: string;
  userId: string;
};

type createOrgBody = {
  data: {
    name: string;
    slug?: string;
  };
};

type addMemberBody = {
  data: {
    userId?: string;
    email?: string;
    role?: OrgRole;
  };
};

type updateRoleBody = {
  data: {
    role: OrgRole;
  };
};

type updateOrgBody = {
  data: {
    name?: string;
    slug?: string;
  };
};

export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  getUserOrganizations: Controller = async (req, res, next) => {
    try {
      const orgs = await this.orgService.getUserOrganizations(req.userId!);
      res.status(200).json({
        message: "Organizations fetched successfully",
        success: true,
        data: orgs,
      });
    } catch (err) {
      next(err);
    }
  };

  getOrganizationById: ParamsController<orgParams> = async (req, res, next) => {
    try {
      const orgId = req.params.id;
      const org = await this.orgService.getOrganization(orgId, req.userId!);
      res.status(200).json({
        message: "Organization fetched successfully",
        success: true,
        data: org,
      });
    } catch (err) {
      next(err);
    }
  };

  createOrganization: BodyController<createOrgBody> = async (req, res, next) => {
    try {
      const { data } = req.body;
      const org = await this.orgService.createOrganization(data, req.userId!);
      res.status(201).json({
        message: "Organization created successfully",
        success: true,
        data: org,
      });
    } catch (err) {
      next(err);
    }
  };

  updateOrganization: BodyParamsController<updateOrgBody, orgParams> = async (req, res, next) => {
    try {
      const orgId = req.params.id;
      const { data } = req.body;
      const org = await this.orgService.updateOrganization(orgId, data, req.userId!);
      res.status(200).json({
        message: "Organization updated successfully",
        success: true,
        data: org,
      });
    } catch (err) {
      next(err);
    }
  };

  addMember: BodyParamsController<addMemberBody, orgParams> = async (req, res, next) => {
    try {
      const orgId = req.params.id;
      const { data } = req.body;
      const member = await this.orgService.addMember(orgId, data, req.userId!);
      res.status(201).json({
        message: "Member added to organization successfully",
        success: true,
        data: member,
      });
    } catch (err) {
      next(err);
    }
  };

  updateMemberRole: BodyParamsController<updateRoleBody, memberParams> = async (
    req,
    res,
    next,
  ) => {
    try {
      const { id: orgId, userId: targetUserId } = req.params;
      const { data } = req.body;
      const member = await this.orgService.updateMemberRole(
        orgId,
        targetUserId,
        data.role,
        req.userId!,
      );
      res.status(200).json({
        message: "Member role updated successfully",
        success: true,
        data: member,
      });
    } catch (err) {
      next(err);
    }
  };

  removeMember: ParamsController<memberParams> = async (req, res, next) => {
    try {
      const { id: orgId, userId: targetUserId } = req.params;
      const member = await this.orgService.removeMember(orgId, targetUserId, req.userId!);
      res.status(200).json({
        message: "Member removed from organization successfully",
        success: true,
        data: member,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteOrganization: ParamsController<orgParams> = async (req, res, next) => {
    try {
      const orgId = req.params.id;
      const deleted = await this.orgService.deleteOrganization(orgId, req.userId!);
      res.status(200).json({
        message: "Organization deleted successfully",
        success: true,
        data: deleted,
      });
    } catch (err) {
      next(err);
    }
  };
}
