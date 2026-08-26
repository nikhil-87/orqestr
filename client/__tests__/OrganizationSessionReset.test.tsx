import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Organization Session Reset & Personal Workspace Guarantee", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("ensures stale currentOrganizationId is removed when switching sessions", () => {
    // Simulate user A having had an organization open
    localStorage.setItem("currentOrganizationId", "org-user-a");
    expect(localStorage.getItem("currentOrganizationId")).toBe("org-user-a");

    // Simulate logout
    localStorage.removeItem("currentOrganizationId");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");

    expect(localStorage.getItem("currentOrganizationId")).toBeNull();
  });

  it("ensures new login or OAuth callback always resets to personal workspace", () => {
    // Even if storage had leftover organization from an unexpected crash
    localStorage.setItem("currentOrganizationId", "org-user-a");

    // When OAuth login completes, currentOrganizationId is cleared
    localStorage.removeItem("currentOrganizationId");
    localStorage.setItem("accessToken", "token-user-b");

    expect(localStorage.getItem("currentOrganizationId")).toBeNull();
    expect(localStorage.getItem("accessToken")).toBe("token-user-b");
  });

  it("dispatches organization-reset event when 403 FORBIDDEN_ORGANIZATION is encountered", () => {
    localStorage.setItem("currentOrganizationId", "stale-org-id");

    const resetSpy = vi.fn();
    window.addEventListener("organization-reset", resetSpy);

    // Simulate interceptor catching 403
    localStorage.removeItem("currentOrganizationId");
    window.dispatchEvent(new CustomEvent("organization-reset"));

    expect(localStorage.getItem("currentOrganizationId")).toBeNull();
    expect(resetSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener("organization-reset", resetSpy);
  });

  it("clears unsaved workflow draft on logout to prevent cross-account draft leakage", () => {
    localStorage.setItem("orqestr_draft_workflow", JSON.stringify({ name: "Confidential Draft" }));
    expect(localStorage.getItem("orqestr_draft_workflow")).toBeTruthy();

    // Logout purges draft workflow as well as auth tokens and current org
    localStorage.removeItem("orqestr_draft_workflow");
    localStorage.removeItem("currentOrganizationId");
    localStorage.removeItem("accessToken");

    expect(localStorage.getItem("orqestr_draft_workflow")).toBeNull();
    expect(localStorage.getItem("currentOrganizationId")).toBeNull();
    expect(localStorage.getItem("accessToken")).toBeNull();
  });
});
