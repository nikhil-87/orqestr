import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { createAuthRouter } from "../../api/auth/auth.routes";
import { errorHandlerMiddleware } from "../../middleware/error.middleware";
import config from "../../config";
import { redis } from "../../config/redis.config";

// Mock config module so we can change client IDs dynamically in tests
vi.mock("../../config", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config")>();
  return {
    default: {
      ...original.default,
      GOOGLE_CLIENT_ID: "mock-google-client-id",
      GOOGLE_CLIENT_SECRET: "mock-google-client-secret",
      GITHUB_CLIENT_ID: "mock-github-client-id",
      GITHUB_CLIENT_SECRET: "mock-github-client-secret",
      CLIENT_URL: "http://localhost:3000",
    },
  };
});

function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

function createTestApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(prisma));
  app.use(errorHandlerMiddleware);
  return app;
}

describe("OAuth API Integration Tests", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let app: ReturnType<typeof createTestApp>;
  let mockFetch: any;
  let redisStore: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    app = createTestApp(prisma);
    redisStore = new Map<string, string>();

    // Mock Redis in-memory storage for state & one-time code exchange
    (redis.get as any).mockImplementation(async (key: string) => {
      return redisStore.get(key) ?? null;
    });
    (redis.setex as any).mockImplementation(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value);
      return "OK";
    });
    (redis.del as any).mockImplementation(async (key: string) => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    });

    // Default global fetch mock for Google and GitHub endpoints
    mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes("oauth2.googleapis.com/token") ||
        url.includes("github.com/login/oauth/access_token")
      ) {
        return {
          ok: true,
          json: async () => ({ access_token: "mock-access-token" }),
        };
      }
      if (url.includes("googleapis.com/oauth2/v3/userinfo")) {
        return {
          ok: true,
          json: async () => ({
            sub: "google-user-id",
            email: "google-user@test.com",
            name: "Google User",
          }),
        };
      }
      if (url.includes("api.github.com/user/emails")) {
        return {
          ok: true,
          json: async () => [
            { email: "github-fallback-email@test.com", primary: true, verified: true },
            { email: "github-secondary-email@test.com", primary: false, verified: true },
          ],
        };
      }
      if (url.includes("api.github.com/user")) {
        return {
          ok: true,
          json: async () => ({
            id: 12345,
            name: "GitHub User",
            login: "githubuser",
            email: "github-user@test.com",
          }),
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Google & GitHub Redirect Tests ──────────────────────────────────────────

  describe("GET /api/auth/google (Redirect)", () => {
    it("generates cryptographic state and redirects to Google OAuth page", async () => {
      const res = await request(app).get("/api/auth/google").expect(302);

      expect(res.headers.location).toContain("https://accounts.google.com/o/oauth2/v2/auth");

      const redirectUrl = new URL(res.headers.location);
      expect(redirectUrl.searchParams.get("client_id")).toBe("mock-google-client-id");
      expect(redirectUrl.searchParams.get("response_type")).toBe("code");
      expect(redirectUrl.searchParams.get("scope")).toBe("openid email profile");

      const state = redirectUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(state!.length).toBe(64); // 32 hex bytes
      expect(redisStore.get(`oauth:state:${state}`)).toBe("google");
    });

    it("returns 503 if Google OAuth is not configured", async () => {
      vi.mocked(config).GOOGLE_CLIENT_ID = "";

      const res = await request(app).get("/api/auth/google").expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Google OAuth is not configured");

      vi.mocked(config).GOOGLE_CLIENT_ID = "mock-google-client-id";
    });
  });

  describe("GET /api/auth/github (Redirect)", () => {
    it("generates cryptographic state and redirects to GitHub OAuth page", async () => {
      const res = await request(app).get("/api/auth/github").expect(302);

      expect(res.headers.location).toContain("https://github.com/login/oauth/authorize");

      const redirectUrl = new URL(res.headers.location);
      expect(redirectUrl.searchParams.get("client_id")).toBe("mock-github-client-id");
      expect(redirectUrl.searchParams.get("scope")).toBe("user:email read:user");

      const state = redirectUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(state!.length).toBe(64);
      expect(redisStore.get(`oauth:state:${state}`)).toBe("github");
    });

    it("returns 503 if GitHub OAuth is not configured", async () => {
      vi.mocked(config).GITHUB_CLIENT_ID = "";

      const res = await request(app).get("/api/auth/github").expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("GitHub OAuth is not configured");

      vi.mocked(config).GITHUB_CLIENT_ID = "mock-github-client-id";
    });
  });

  // ── Google Callback Tests ───────────────────────────────────────────────────

  describe("GET /api/auth/google/callback", () => {
    it("redirects to login with error if no code is provided", async () => {
      const res = await request(app).get("/api/auth/google/callback").expect(302);

      expect(res.headers.location).toBe("http://localhost:3000/auth/login?error=no_code");
    });

    it("redirects to login with error if state is missing (CSRF protection)", async () => {
      const res = await request(app)
        .get("/api/auth/google/callback?code=valid-code")
        .expect(302);

      expect(res.headers.location).toBe("http://localhost:3000/auth/login?error=invalid_state");
    });

    it("redirects to login with error if state is invalid or expired", async () => {
      const res = await request(app)
        .get("/api/auth/google/callback?code=valid-code&state=nonexistent-state")
        .expect(302);

      expect(res.headers.location).toBe("http://localhost:3000/auth/login?error=invalid_state");
    });

    it("registers new user, validates & consumes state, and returns one-time code", async () => {
      const validState = "valid-google-state-12345";
      redisStore.set(`oauth:state:${validState}`, "google");

      prisma.user.findUnique.mockResolvedValueOnce(null); // googleId check
      prisma.user.findUnique.mockResolvedValueOnce(null); // email check
      prisma.user.create.mockResolvedValue({
        id: "new-user-id",
        email: "google-user@test.com",
        name: "Google User",
      } as any);
      prisma.refreshToken.create.mockResolvedValue({} as any);

      const res = await request(app)
        .get(`/api/auth/google/callback?code=valid-code&state=${validState}`)
        .expect(302);

      // Verify redirect uses one-time code and NOT JWT in query string
      expect(res.headers.location).toContain("http://localhost:3000/auth/callback?code=");
      expect(res.headers.location).not.toContain("token=");
      expect(res.headers["set-cookie"][0]).toContain("refreshToken=");

      // Verify state was consumed (one-time use)
      expect(redisStore.has(`oauth:state:${validState}`)).toBe(false);

      // Verify one-time exchange code exists in redis
      const redirectUrl = new URL(res.headers.location);
      const exchangeCode = redirectUrl.searchParams.get("code");
      expect(exchangeCode).toBeTruthy();
      expect(redisStore.has(`oauth:exchange:${exchangeCode}`)).toBe(true);

      // Verify database record creation
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "google-user@test.com",
            name: "Google User",
            googleId: "google-user-id",
          }),
        }),
      );
    });

    it("prevents state replay attacks (cannot reuse same state)", async () => {
      const validState = "replay-test-state";
      redisStore.set(`oauth:state:${validState}`, "google");

      prisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        email: "google-user@test.com",
        name: "Google User",
        googleId: "google-user-id",
      } as any);
      prisma.refreshToken.create.mockResolvedValue({} as any);

      // First request succeeds
      await request(app)
        .get(`/api/auth/google/callback?code=valid-code&state=${validState}`)
        .expect(302);

      // Second request with same state fails
      const secondRes = await request(app)
        .get(`/api/auth/google/callback?code=valid-code&state=${validState}`)
        .expect(302);

      expect(secondRes.headers.location).toBe(
        "http://localhost:3000/auth/login?error=invalid_state",
      );
    });

    it("returns 400 if Google token exchange fails", async () => {
      const validState = "error-state";
      redisStore.set(`oauth:state:${validState}`, "google");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const res = await request(app)
        .get(`/api/auth/google/callback?code=invalid-code&state=${validState}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe("OAUTH_ERROR");
      expect(res.body.message).toContain("Failed to exchange Google authorization code");
    });
  });

  // ── GitHub Callback Tests ──────────────────────────────────────────────────

  describe("GET /api/auth/github/callback", () => {
    it("redirects to login with error if no code is provided", async () => {
      const res = await request(app).get("/api/auth/github/callback").expect(302);

      expect(res.headers.location).toBe("http://localhost:3000/auth/login?error=no_code");
    });

    it("redirects to login with error if state is missing (CSRF protection)", async () => {
      const res = await request(app)
        .get("/api/auth/github/callback?code=valid-code")
        .expect(302);

      expect(res.headers.location).toBe("http://localhost:3000/auth/login?error=invalid_state");
    });

    it("registers and logs in a new user when GitHub profile has a public email", async () => {
      const validState = "valid-github-state";
      redisStore.set(`oauth:state:${validState}`, "github");

      prisma.user.findUnique.mockResolvedValueOnce(null); // githubId check
      prisma.user.findUnique.mockResolvedValueOnce(null); // email check
      prisma.user.create.mockResolvedValue({
        id: "new-user-id",
        email: "github-user@test.com",
        name: "GitHub User",
      } as any);
      prisma.refreshToken.create.mockResolvedValue({} as any);

      const res = await request(app)
        .get(`/api/auth/github/callback?code=valid-code&state=${validState}`)
        .expect(302);

      expect(res.headers.location).toContain("http://localhost:3000/auth/callback?code=");
      expect(res.headers.location).not.toContain("token=");
      expect(res.headers["set-cookie"][0]).toContain("refreshToken=");
      expect(redisStore.has(`oauth:state:${validState}`)).toBe(false);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "github-user@test.com",
            name: "GitHub User",
            githubId: "12345",
          }),
        }),
      );
    });

    it("falls back to emails endpoint if GitHub profile email is private/null", async () => {
      const validState = "github-fallback-state";
      redisStore.set(`oauth:state:${validState}`, "github");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "mock-access-token" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          name: "GitHub User",
          login: "githubuser",
          email: null,
        }),
      });

      prisma.user.findUnique.mockResolvedValueOnce(null); // githubId check
      prisma.user.findUnique.mockResolvedValueOnce(null); // email check
      prisma.user.create.mockResolvedValue({
        id: "new-user-id",
        email: "github-fallback-email@test.com",
        name: "GitHub User",
      } as any);
      prisma.refreshToken.create.mockResolvedValue({} as any);

      const res = await request(app)
        .get(`/api/auth/github/callback?code=valid-code&state=${validState}`)
        .expect(302);

      expect(res.headers.location).toContain("http://localhost:3000/auth/callback?code=");
      expect(res.headers.location).not.toContain("token=");
    });

    it("returns 400 if GitHub token exchange fails", async () => {
      const validState = "github-err-state";
      redisStore.set(`oauth:state:${validState}`, "github");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const res = await request(app)
        .get(`/api/auth/github/callback?code=invalid-code&state=${validState}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe("OAUTH_ERROR");
    });
  });

  // ── One-Time OAuth Code Exchange Tests ───────────────────────────────────────

  describe("POST /api/auth/oauth/exchange", () => {
    it("successfully exchanges a valid code for tokens and session data", async () => {
      const exchangeCode = "exchange-code-12345";
      const payload = {
        accessToken: "sample-jwt-access-token",
        refreshToken: "sample-jwt-refresh-token",
        user: { id: "u-1", email: "user@test.com", name: "User One" },
      };
      redisStore.set(`oauth:exchange:${exchangeCode}`, JSON.stringify(payload));

      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code: exchangeCode })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBe(payload.accessToken);
      expect(res.body.data.user.email).toBe(payload.user.email);
      expect(res.headers["set-cookie"][0]).toContain("refreshToken=");

      // Verify code was deleted after exchange (cannot be reused)
      expect(redisStore.has(`oauth:exchange:${exchangeCode}`)).toBe(false);
    });

    it("rejects reuse of the same exchange code", async () => {
      const exchangeCode = "reuse-test-code";
      const payload = {
        accessToken: "tok-1",
        refreshToken: "ref-1",
        user: { id: "u-1" },
      };
      redisStore.set(`oauth:exchange:${exchangeCode}`, JSON.stringify(payload));

      // First exchange succeeds
      await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code: exchangeCode })
        .expect(200);

      // Second exchange fails
      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code: exchangeCode })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe("INVALID_EXCHANGE_CODE");
    });

    it("returns 400 if exchange code is missing", async () => {
      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe("INVALID_EXCHANGE_CODE");
    });
  });
});
