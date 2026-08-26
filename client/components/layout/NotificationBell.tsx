"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bell,
  CheckCheck,
  Building2,
  Users,
  ShieldCheck,
  X,
  ArrowRight,
  Loader2,
} from "lucide-react";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  type NotificationItem,
} from "@/hooks/use-notifications";
import { useCurrentOrg } from "@/providers/organization-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { formatRelativeTime, formatDateTime } from "@/lib/utils/date";

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading } = useNotifications(!!user?.id);
  const { mutate: markRead } = useMarkNotificationRead();
  const { mutate: markAllRead, isPending: isMarkingAll } = useMarkAllNotificationsRead();
  const { mutate: deleteNotif } = useDeleteNotification();
  const { switchOrganization } = useCurrentOrg();

  const notifications: NotificationItem[] = data?.notifications ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleNotificationClick = (notif: NotificationItem) => {
    if (!notif.isRead) {
      markRead(notif.id);
    }
    if (notif.organizationId) {
      switchOrganization(notif.organizationId, notif.metadata?.organizationName);
      router.push("/workflows");
    }
    setIsOpen(false);
  };

  const handleDismiss = (e: React.MouseEvent, notifId: string) => {
    e.stopPropagation();
    deleteNotif(notifId);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95 cursor-pointer"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-border bg-card p-4 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {unreadCount} new
                </span>
              )}
            </div>
            {notifications.length > 0 && unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                disabled={isMarkingAll}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                {isMarkingAll ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
                Mark all read
              </button>
            )}
          </div>

          <div className="mt-3 max-h-80 overflow-y-auto space-y-2 divide-y divide-border/40">
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <Bell className="mx-auto mb-2 h-5 w-5 opacity-40" />
                No notifications yet.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`group relative flex items-start gap-3 rounded-xl p-3 pt-3 transition-all cursor-pointer ${
                    notif.isRead
                      ? "hover:bg-secondary/30 text-muted-foreground"
                      : "bg-primary/5 hover:bg-primary/10 text-foreground"
                  }`}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/80 text-foreground">
                    {notif.type === "WORKSPACE_ROLE_CHANGE" ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="text-xs font-semibold text-foreground truncate">
                        {notif.title}
                      </h4>
                      <span
                        className="text-[10px] text-muted-foreground shrink-0 font-mono tabular-nums"
                        title={formatDateTime(notif.createdAt)}
                      >
                        {formatRelativeTime(notif.createdAt)}
                      </span>
                    </div>

                    <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                      {notif.message}
                    </p>

                    {notif.organizationId && (
                      <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-primary">
                        <span>Switch to workspace</span>
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleDismiss(e, notif.id)}
                    title="Dismiss"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
