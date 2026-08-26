import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./helpers";
import NotificationBell from "@/components/layout/NotificationBell";

const mockNotifications = [
  {
    id: "notif-1",
    userId: "u-1",
    title: "Added to Workspace",
    message: "Nikhil added you to Acme Engineering as MEMBER",
    type: "WORKSPACE_INVITE",
    organizationId: "org-acme",
    metadata: {
      organizationId: "org-acme",
      organizationName: "Acme Engineering",
      role: "MEMBER",
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  },
];

const mockSwitchOrganization = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockDeleteNotification = vi.fn();

vi.mock("@/providers/organization-provider", () => ({
  useCurrentOrg: () => ({
    switchOrganization: mockSwitchOrganization,
  }),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "test@example.com", name: "Test User" },
  }),
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    data: {
      notifications: mockNotifications,
      unreadCount: 1,
    },
    isLoading: false,
  }),
  useMarkNotificationRead: () => ({
    mutate: mockMarkRead,
  }),
  useMarkAllNotificationsRead: () => ({
    mutate: mockMarkAllRead,
    isPending: false,
  }),
  useDeleteNotification: () => ({
    mutate: mockDeleteNotification,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the notification bell with unread count badge", () => {
    render(<NotificationBell />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens popover on click and renders workspace invite notification", () => {
    render(<NotificationBell />);
    const bellButton = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(bellButton);

    expect(screen.getByText("Added to Workspace")).toBeInTheDocument();
    expect(
      screen.getByText("Nikhil added you to Acme Engineering as MEMBER"),
    ).toBeInTheDocument();
    expect(screen.getByText("Switch to workspace")).toBeInTheDocument();
  });

  it("switches to workspace and marks notification as read when clicked", () => {
    render(<NotificationBell />);
    const bellButton = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(bellButton);

    const notifItem = screen.getByText("Added to Workspace").closest("div");
    if (notifItem) {
      fireEvent.click(notifItem);
      expect(mockMarkRead).toHaveBeenCalledWith("notif-1");
      expect(mockSwitchOrganization).toHaveBeenCalledWith("org-acme", "Acme Engineering");
    }
  });
});
