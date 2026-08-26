import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { AuthService } from "./auth.service";
import config from "../../config";
import { redis } from "../../config/redis.config";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Email / Password ─────────────────────────────────────────────────────────

  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, name } = req.body;
      const result = await this.authService.register({ email, password, name });

      this.setRefreshCookie(res, result.refreshToken);

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const result = await this.authService.login({ email, password });

      this.setRefreshCookie(res, result.refreshToken);

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (!refreshToken) {
        res.status(401).json({
          success: false,
          message: "Refresh token required",
          errorCode: "UNAUTHORIZED",
        });
        return;
      }

      const result = await this.authService.refresh(refreshToken);

      this.setRefreshCookie(res, result.refreshToken);

      res.status(200).json({
        success: true,
        message: "Token refreshed successfully",
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }

      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/api/auth",
      });

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (err) {
      next(err);
    }
  };

  // ── /me ──────────────────────────────────────────────────────────────────────

  me = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await this.authService.getMe(req.userId!);
      res.status(200).json({ success: true, data: { user } });
    } catch (err) {
      next(err);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────────

  googleRedirect = async (_req: Request, res: Response) => {
    if (!config.GOOGLE_CLIENT_ID) {
      res.status(503).json({ success: false, message: "Google OAuth is not configured" });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    await redis.setex(`oauth:state:${state}`, 300, "google");

    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_CALLBACK_URL,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
      state,
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  };

  googleCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code) {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=no_code`);
        return;
      }

      if (!state) {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=invalid_state`);
        return;
      }

      const stateKey = `oauth:state:${state}`;
      const storedProvider = await redis.get(stateKey);
      if (!storedProvider || storedProvider !== "google") {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=invalid_state`);
        return;
      }
      await redis.del(stateKey);

      const result = await this.authService.googleLogin(code);
      this.setRefreshCookie(res, result.refreshToken);

      // Issue ephemeral single-use exchange code instead of leaking JWT in URL
      const exchangeCode = crypto.randomBytes(32).toString("hex");
      await redis.setex(
        `oauth:exchange:${exchangeCode}`,
        60,
        JSON.stringify({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        }),
      );

      res.redirect(`${config.CLIENT_URL}/auth/callback?code=${exchangeCode}`);
    } catch (err) {
      next(err);
    }
  };

  // ── GitHub OAuth ─────────────────────────────────────────────────────────────

  githubRedirect = async (_req: Request, res: Response) => {
    if (!config.GITHUB_CLIENT_ID) {
      res.status(503).json({ success: false, message: "GitHub OAuth is not configured" });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    await redis.setex(`oauth:state:${state}`, 300, "github");

    const params = new URLSearchParams({
      client_id: config.GITHUB_CLIENT_ID,
      redirect_uri: config.GITHUB_CALLBACK_URL,
      scope: "user:email read:user",
      state,
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  };

  githubCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code) {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=no_code`);
        return;
      }

      if (!state) {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=invalid_state`);
        return;
      }

      const stateKey = `oauth:state:${state}`;
      const storedProvider = await redis.get(stateKey);
      if (!storedProvider || storedProvider !== "github") {
        res.redirect(`${config.CLIENT_URL}/auth/login?error=invalid_state`);
        return;
      }
      await redis.del(stateKey);

      const result = await this.authService.githubLogin(code);
      this.setRefreshCookie(res, result.refreshToken);

      // Issue ephemeral single-use exchange code instead of leaking JWT in URL
      const exchangeCode = crypto.randomBytes(32).toString("hex");
      await redis.setex(
        `oauth:exchange:${exchangeCode}`,
        60,
        JSON.stringify({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        }),
      );

      res.redirect(`${config.CLIENT_URL}/auth/callback?code=${exchangeCode}`);
    } catch (err) {
      next(err);
    }
  };

  // ── One-Time OAuth Code Exchange ─────────────────────────────────────────────

  exchangeOAuthCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== "string") {
        res.status(400).json({
          success: false,
          message: "Exchange code is required",
          errorCode: "INVALID_EXCHANGE_CODE",
        });
        return;
      }

      const key = `oauth:exchange:${code}`;
      const dataStr = await redis.get(key);
      if (!dataStr) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired authorization exchange code",
          errorCode: "INVALID_EXCHANGE_CODE",
        });
        return;
      }

      // Delete immediately to enforce single-use
      await redis.del(key);

      const payload = JSON.parse(dataStr);
      this.setRefreshCookie(res, payload.refreshToken);

      res.status(200).json({
        success: true,
        message: "OAuth exchange successful",
        data: payload,
      });
    } catch (err) {
      next(err);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, refreshToken: string) {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/",
      maxAge: this.authService.getRefreshTokenExpiryMs(),
    });
  }
}
