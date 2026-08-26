import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { createRedisRateLimiter } from "../../middleware/rate-limiter.middleware";

export const createAuthRouter = (prisma: PrismaClient) => {
  const router = Router();

  const repository = new AuthRepository(prisma);
  const service = new AuthService(repository);
  const controller = new AuthController(service);

  const registerLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: "rl:auth:register",
  });

  const loginLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: "rl:auth:login",
  });

  const refreshLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: "rl:auth:refresh",
  });

  const oauthExchangeLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 15,
    keyPrefix: "rl:auth:oauth-exchange",
  });

  // Email / Password with rate limiting
  router.post("/register", registerLimiter, controller.register);
  router.post("/login", loginLimiter, controller.login);
  router.post("/refresh", refreshLimiter, controller.refresh);
  router.post("/logout", controller.logout);

  // Profile (protected)
  router.get("/me", authenticate, controller.me);

  // Google OAuth
  router.get("/google", controller.googleRedirect);
  router.get("/google/callback", controller.googleCallback);

  // GitHub OAuth
  router.get("/github", controller.githubRedirect);
  router.get("/github/callback", controller.githubCallback);

  // One-time OAuth code exchange
  router.post("/oauth/exchange", oauthExchangeLimiter, controller.exchangeOAuthCode);

  return router;
};
