import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { ApiError } from "../utils/errors";
import { prisma as defaultPrisma } from "../config/prisma.config";

export const createOrgMiddleware = (prisma: PrismaClient = defaultPrisma) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const orgIdHeader = req.headers["x-organization-id"];

    if (!orgIdHeader || typeof orgIdHeader !== "string" || orgIdHeader.trim() === "") {
      req.organizationId = undefined;
      return next();
    }

    const orgId = orgIdHeader.trim();
    const userId = req.userId;

    if (!userId) {
      return next();
    }

    try {
      const membership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId,
          },
        },
      });

      if (!membership) {
        throw new ApiError(
          "You are not a member of this organization",
          403,
          "FORBIDDEN_ORGANIZATION",
        );
      }

      req.organizationId = orgId;
      next();
    } catch (err) {
      next(err);
    }
  };
};
