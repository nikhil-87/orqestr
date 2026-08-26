import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OrganizationModal from "../components/organization/OrganizationModal";

const mockUser = {
  id: "user-1",
  email: "alice@company.com",
  name: "Alice",
};

const mockCurrentOrg = {
  id: "org-123",
  name: "Acme Corp",
  slug: "acme-corp",
  createdAt: "2026-08-20T10:00:00.000Z",
  members: [
    {
      id: "mem-1",
      userId: "user-1",
      role: "OWNER",
      user: { id: "user-1", name: "Alice", email: "alice@company.com" },
    },
    {
      id: "mem-2",
      userId: "user-2",
      role: "ADMIN",
      user: { id: "user-2", name: "Bob", email: "bob@company.com" },
    },
    {
      id: "mem-3",
      userId: "user-3",
      role: "MEMBER",
      user: { id: "user-3", name: "Charlie", email: "charlie@company.com" },
    },
    {
      id: "mem-4",
      userId: "user-4",
      role: "MEMBER",
      user: { id: "user-4", name: "Dana", email: "dana@company.com" },
    },
  ],
};

let mockUserRole: "OWNER" | "ADMIN" | "MEMBER" = "OWNER";
let mockIsOwner = true;
let mockIsAdmin = true;

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/providers/organization-provider", () => ({
  useCurrentOrg: () => ({
    currentOrg: mockCurrentOrg,
    userRole: mockUserRole,
    isOwner: mockIsOwner,
    isAdmin: mockIsAdmin,
    switchOrganization: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-organization", () => ({
  useAddMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("OrganizationModal Component", () => {
  beforeEach(() => {
    mockUserRole = "OWNER";
    mockIsOwner = true;
    mockIsAdmin = true;
    vi.clearAllMocks();
  });

  it("renders with bounded max-height constraints so modal does not overflow screen", () => {
    render(<OrganizationModal open={true} onOpenChange={vi.fn()} />);

    // Dialog title and slug
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("acme-corp")).toBeInTheDocument();

    // Verify dialog content has max-height and flex-col styling
    const dialogContent = screen.getByText("Acme Corp").closest("[data-slot='dialog-content']");
    expect(dialogContent).toHaveClass("max-h-[85vh]");
    expect(dialogContent).toHaveClass("flex");
    expect(dialogContent).toHaveClass("flex-col");
  });

  it("renders member list in a bounded scroll container", () => {
    render(<OrganizationModal open={true} onOpenChange={vi.fn()} />);

    // Team Members (4)
    expect(screen.getByText("Team Members (4)")).toBeInTheDocument();
    expect(screen.getByText("Active Members (4)")).toBeInTheDocument();

    // All 4 members should be rendered
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Dana")).toBeInTheDocument();

    // Verify member list container has max-h-52 or max-h-56 with overflow-y-auto
    const memberContainer = screen.getByText("Alice").closest(".max-h-52, .max-h-56");
    expect(memberContainer).not.toBeNull();
    expect(memberContainer).toHaveClass("overflow-y-auto");
  });

  it("navigates to Role Permissions tab when clicking Role Permissions in tab bar", () => {
    render(<OrganizationModal open={true} onOpenChange={vi.fn()} />);

    const permissionsTab = screen.getByRole("button", { name: /^Role Permissions$/i });
    fireEvent.click(permissionsTab);

    // Should display Role capabilities for the user
    expect(screen.getByText("Your Assigned Role in this Workspace")).toBeInTheDocument();
    expect(screen.getByText(/What you are allowed to do:/i)).toBeInTheDocument();
    expect(screen.getByText("Workspace Roles Matrix")).toBeInTheDocument();
  });

  it("navigates to Role Permissions tab when clicking the user's role badge in the dialog header", () => {
    render(<OrganizationModal open={true} onOpenChange={vi.fn()} />);

    // In header, the role badge button has title "Click to view what your role allows you to do"
    const headerRoleBadge = screen.getByTitle("Click to view what your role allows you to do");
    fireEvent.click(headerRoleBadge);

    expect(screen.getByText("Your Assigned Role in this Workspace")).toBeInTheDocument();
  });

  it("displays allowed and restricted actions accurately for MEMBER role", () => {
    mockUserRole = "MEMBER";
    mockIsOwner = false;
    mockIsAdmin = false;

    render(<OrganizationModal open={true} onOpenChange={vi.fn()} />);

    const permissionsTab = screen.getByRole("button", { name: /^Role Permissions$/i });
    fireEvent.click(permissionsTab);

    expect(screen.getByText(/You are currently authenticated as an active/i)).toBeInTheDocument();
    expect(screen.getAllByText("MEMBER").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Build, configure, and edit all workflows in this workspace/i)).toBeInTheDocument();

    // Restricted actions for member
    expect(screen.getByText(/Restricted actions:/i)).toBeInTheDocument();
    expect(screen.getByText(/Inviting new members or managing team roles/i)).toBeInTheDocument();
  });
});
