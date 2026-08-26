import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  sanitizeLogValue,
  sanitizeWinstonInfo,
} from "../../utils/log-sanitizer";

describe("Log Sanitization & Redaction Engine", () => {
  describe("sanitizeString", () => {
    it("redacts passwords in PostgreSQL connection URIs", () => {
      const input = "Failed to connect to postgresql://postgres:mySuperSecretPassword123@db.neon.tech:5432/orqestr";
      const result = sanitizeString(input);
      expect(result).toBe("Failed to connect to postgresql://postgres:***@db.neon.tech:5432/orqestr");
      expect(result).not.toContain("mySuperSecretPassword123");
    });

    it("redacts passwords in Redis connection URIs", () => {
      const input = "Connecting to redis://:redisSecretPassword456@redis-cluster.internal:6379";
      const result = sanitizeString(input);
      expect(result).toBe("Connecting to redis://:***@redis-cluster.internal:6379");
      expect(result).not.toContain("redisSecretPassword456");
    });

    it("redacts Bearer authorization tokens", () => {
      const input = "Authorization header received: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456";
      const result = sanitizeString(input);
      expect(result).toContain("Bearer [REDACTED]");
      expect(result).not.toContain("abc123def456");
    });

    it("redacts standalone JWT tokens in messages", () => {
      const input = "Token is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMyJ9.validSignatureStringHere";
      const result = sanitizeString(input);
      expect(result).toBe("Token is [JWT_REDACTED]");
      expect(result).not.toContain("validSignatureStringHere");
    });

    it("redacts Groq API keys", () => {
      const input = "Error using key gsk_AbCdEfGhIjKlMnOpQrStUvWxYz123456 with model gpt-oss";
      const result = sanitizeString(input);
      expect(result).toContain("gsk_***[REDACTED]");
      expect(result).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz123456");
    });

    it("redacts GitHub personal access tokens", () => {
      const input = "GitHub token ghp_1234567890abcdef1234567890abcdef123456 failed";
      const result = sanitizeString(input);
      expect(result).toContain("gh_***[REDACTED]");
      expect(result).not.toContain("1234567890abcdef");
    });

    it("redacts sensitive query parameters from URLs", () => {
      const input = "GET /api/auth/callback?code=super-secret-auth-code&state=csrf-token-12345&other=safe";
      const result = sanitizeString(input);
      expect(result).toContain("code=[REDACTED]");
      expect(result).toContain("state=[REDACTED]");
      expect(result).toContain("other=safe");
      expect(result).not.toContain("super-secret-auth-code");
      expect(result).not.toContain("csrf-token-12345");
    });

    it("redacts private keys", () => {
      const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m...\n-----END RSA PRIVATE KEY-----";
      const result = sanitizeString(input);
      expect(result).toBe("[PRIVATE_KEY_REDACTED]");
    });
  });

  describe("sanitizeLogValue", () => {
    it("redacts sensitive keys in plain objects while preserving other properties", () => {
      const userPayload = {
        id: "user-123",
        email: "alice@example.com",
        password: "plainTextPassword!",
        refreshToken: "refresh-token-xyz",
        metadata: {
          apiKey: "my-secret-key",
          theme: "dark",
        },
      };

      const result = sanitizeLogValue(userPayload) as typeof userPayload;
      expect(result.id).toBe("user-123");
      expect(result.email).toBe("alice@example.com");
      expect(result.password).toBe("[REDACTED]");
      expect(result.refreshToken).toBe("[REDACTED]");
      expect(result.metadata.apiKey).toBe("[REDACTED]");
      expect(result.metadata.theme).toBe("dark");
    });

    it("handles circular references safely without throwing", () => {
      const circularObj: any = { name: "test-node" };
      circularObj.self = circularObj;

      const result = sanitizeLogValue(circularObj) as any;
      expect(result.name).toBe("test-node");
      expect(result.self).toBe("[Circular]");
    });

    it("sanitizes Error instances preserving name, message, and sanitized stack", () => {
      const err = new Error("PrismaClientInitializationError: Failed to connect to postgresql://postgres:dbpass@db.local:5432/mydb");
      err.stack = "Error: Failed to connect to postgresql://postgres:dbpass@db.local:5432/mydb\n    at Object.<anonymous> (server/db.ts:12:9)";

      const result = sanitizeLogValue(err) as any;
      expect(result.name).toBe("Error");
      expect(result.message).toContain("postgresql://postgres:***@db.local:5432/mydb");
      expect(result.message).not.toContain("dbpass");
      expect(result.stack).toContain("server/db.ts:12:9");
      expect(result.stack).not.toContain("dbpass");
    });
  });

  describe("sanitizeWinstonInfo", () => {
    it("transforms Winston info object to sanitize message, stack, and metadata", () => {
      const winstonInfo = {
        level: "error",
        timestamp: "26/08/2026, 21:30:00",
        message: "Login failed for postgresql://u:p@db:5432/d with token Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
        stack: "Error at postgresql://u:p@db:5432/d",
        password: "secretPassword",
        requestId: "req-123",
      };

      const sanitized = sanitizeWinstonInfo(winstonInfo);
      expect(sanitized.level).toBe("error");
      expect(sanitized.timestamp).toBe("26/08/2026, 21:30:00");
      expect(sanitized.message).not.toContain("Bearer eyJhbGciOiJIUzI1NiJ9");
      expect(sanitized.message).toContain("Bearer [REDACTED]");
      expect(sanitized.message).toContain("postgresql://u:***@db:5432/d");
      expect(sanitized.stack).toContain("postgresql://u:***@db:5432/d");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.requestId).toBe("req-123");
    });
  });
});
