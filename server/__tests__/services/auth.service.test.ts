import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import config from "../../config";
import { AuthService } from "../../api/auth/auth.service";
import { ValidationError, ApiError } from "../../utils/errors";

function createMockAuthRepository() {
  return {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    createRefreshToken: vi.fn(),
    findRefreshToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
    deleteUserRefreshTokens: vi.fn(),
  };
}

describe("AuthService", () => {
  let repo: ReturnType<typeof createMockAuthRepository>;
  let service: AuthService;

  beforeEach(() => {
    repo = createMockAuthRepository();
    service = new AuthService(repo as any);
  });

  describe("register", () => {
    const validData = {
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    };

    it("registers a new user and returns tokens", async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue({
        id: "user-1",
        email: validData.email,
        name: validData.name,
      } as any);
      repo.createRefreshToken.mockResolvedValue({});

      const result = await service.register(validData);

      expect(result.user.id).toBe("user-1");
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it("throws ValidationError when email is already in use", async () => {
      repo.findByEmail.mockResolvedValue({ id: "existing" } as any);

      await expect(service.register(validData)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when password is too short", async () => {
      await expect(
        service.register({ ...validData, password: "123" }),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when name is missing", async () => {
      await expect(
        service.register({ ...validData, name: "" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("login", () => {
    it("throws ApiError when user not found", async () => {
      repo.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: "notfound@test.com", password: "password123" }),
      ).rejects.toThrow(ApiError);
    });

    it("throws ApiError when email or password missing", async () => {
      await expect(service.login({ email: "", password: "" })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("refresh", () => {
    it("throws ApiError when refresh token is malformed / invalid JWT", async () => {
      await expect(service.refresh("invalid-jwt-token")).rejects.toThrow(ApiError);
    });

    it("throws ApiError when refresh token not found in database", async () => {
      const validJwt = jwt.sign({ tokenId: "token-uuid-1" }, config.JWT_REFRESH_SECRET);
      repo.findRefreshToken.mockResolvedValue(null);

      await expect(service.refresh(validJwt)).rejects.toThrow(ApiError);
      expect(repo.findRefreshToken).toHaveBeenCalledWith("token-uuid-1");
    });

    it("throws ApiError when refresh token expired", async () => {
      const validJwt = jwt.sign({ tokenId: "token-uuid-2" }, config.JWT_REFRESH_SECRET);
      repo.findRefreshToken.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000),
        userId: "user-1",
      } as any);

      await expect(service.refresh(validJwt)).rejects.toThrow(ApiError);
      expect(repo.deleteRefreshToken).toHaveBeenCalledWith("token-uuid-2");
    });

    it("returns a new access token for a valid refresh token", async () => {
      const validJwt = jwt.sign({ tokenId: "token-uuid-3" }, config.JWT_REFRESH_SECRET);
      repo.findRefreshToken.mockResolvedValue({
        expiresAt: new Date(Date.now() + 100000),
        userId: "user-1",
      } as any);
      repo.findById.mockResolvedValue({
        id: "user-1",
        email: "test@test.com",
        name: "Test",
      } as any);

      const result = await service.refresh(validJwt);

      expect(result.accessToken).toBeDefined();
      expect(result.user.id).toBe("user-1");
      expect(repo.findRefreshToken).toHaveBeenCalledWith("token-uuid-3");
    });
  });

  describe("logout", () => {
    it("deletes the refresh token by decoding its tokenId", async () => {
      const validJwt = jwt.sign({ tokenId: "token-uuid-4" }, config.JWT_REFRESH_SECRET);
      await service.logout(validJwt);
      expect(repo.deleteRefreshToken).toHaveBeenCalledWith("token-uuid-4");
    });

    it("falls back to deleting raw string if token is not a valid JWT", async () => {
      await service.logout("raw-token-string");
      expect(repo.deleteRefreshToken).toHaveBeenCalledWith("raw-token-string");
    });
  });
});
