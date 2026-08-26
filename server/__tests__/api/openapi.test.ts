import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { swaggerRouter } from "../../swagger";

function createSwaggerTestApp() {
  const app = express();
  app.use("/api/docs", swaggerRouter);
  return app;
}

describe("Swagger / OpenAPI Documentation", () => {
  const app = createSwaggerTestApp();

  describe("GET /api/docs/openapi.json", () => {
    it("returns a valid OpenAPI 3.0 spec", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      expect(res.body).toHaveProperty("openapi", "3.0.3");
      expect(res.body).toHaveProperty("info");
      expect(res.body.info.title).toBe("Orqestr API");
      expect(res.body.info.version).toBe("1.0.0");
    });

    it("includes all API tags", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      const tagNames = res.body.tags.map((t: { name: string }) => t.name);
      expect(tagNames).toContain("Health");
      expect(tagNames).toContain("Auth");
      expect(tagNames).toContain("Workflows");
      expect(tagNames).toContain("Runs");
      expect(tagNames).toContain("Agents");
      expect(tagNames).toContain("Dashboard");
    });

    it("documents all expected endpoints", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      const paths = Object.keys(res.body.paths);
      expect(paths).toContain("/health");
      expect(paths).toContain("/api/auth/register");
      expect(paths).toContain("/api/auth/login");
      expect(paths).toContain("/api/auth/refresh");
      expect(paths).toContain("/api/auth/logout");
      expect(paths).toContain("/api/auth/me");
      expect(paths).toContain("/api/workflow");
      expect(paths).toContain("/api/workflow/{id}");
      expect(paths).toContain("/api/workflow/{id}/run");
      expect(paths).toContain("/api/runs");
      expect(paths).toContain("/api/runs/{id}");
      expect(paths).toContain("/api/runs/workflow/{workflowId}");
      expect(paths).toContain("/api/runs/{runId}/stream");
      expect(paths).toContain("/api/agents");
      expect(paths).toContain("/api/agents/{id}");
      expect(paths).toContain("/api/dashboard/stats");
      expect(paths).toContain("/api/dashboard/recent-runs");
    });

    it("defines reusable component schemas", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      const schemas = Object.keys(res.body.components.schemas);
      expect(schemas).toContain("User");
      expect(schemas).toContain("AuthTokens");
      expect(schemas).toContain("SuccessResponse");
      expect(schemas).toContain("ErrorResponse");
      expect(schemas).toContain("Workflow");
      expect(schemas).toContain("WorkflowDefinition");
      expect(schemas).toContain("WorkflowNode");
      expect(schemas).toContain("WorkflowEdge");
      expect(schemas).toContain("WorkflowRun");
      expect(schemas).toContain("Task");
      expect(schemas).toContain("Agent");
      expect(schemas).toContain("DashboardStats");
    });

    it("configures bearer auth security scheme", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      expect(res.body.components.securitySchemes.bearerAuth).toEqual({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from login/register endpoints",
      });
    });

    it("marks protected endpoints with security requirement", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      const protectedEndpoints = [
        { path: "/api/auth/me", method: "get" },
        { path: "/api/workflow", method: "get" },
        { path: "/api/workflow", method: "post" },
        { path: "/api/runs", method: "get" },
        { path: "/api/agents", method: "get" },
        { path: "/api/dashboard/stats", method: "get" },
      ];

      for (const endpoint of protectedEndpoints) {
        const operation = res.body.paths[endpoint.path]?.[endpoint.method];
        expect(operation).toBeDefined();
        expect(operation.security).toEqual([{ bearerAuth: [] }]);
      }
    });

    it("does not require auth on public endpoints", async () => {
      const res = await request(app).get("/api/docs/openapi.json").expect(200);

      const publicEndpoints = [
        { path: "/health", method: "get" },
        { path: "/api/auth/register", method: "post" },
        { path: "/api/auth/login", method: "post" },
        { path: "/api/auth/refresh", method: "post" },
        { path: "/api/auth/logout", method: "post" },
      ];

      for (const endpoint of publicEndpoints) {
        const operation = res.body.paths[endpoint.path]?.[endpoint.method];
        expect(operation).toBeDefined();
        expect(operation.security).toBeUndefined();
      }
    });
  });

  describe("GET /api/docs/", () => {
    it("serves the Swagger UI HTML", async () => {
      const res = await request(app).get("/api/docs/").expect(200);

      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("swagger-ui");
    });
  });
});
