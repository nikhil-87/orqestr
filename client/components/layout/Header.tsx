"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PAGE_TITLES } from "@/lib/constants/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useCurrentOrg } from "@/providers/organization-provider";
import NotificationBell from "./NotificationBell";

const Header = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { currentOrg } = useCurrentOrg();
  const [copiedEmail, setCopiedEmail] = useState(false);

  const title =
    PAGE_TITLES[pathname] ??
    pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");

  const handleCopyEmail = () => {
    if (!user?.email) return;
    navigator.clipboard.writeText(user.email);
    setCopiedEmail(true);
    toast.success("Invite email copied to clipboard");
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/70 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <div className="h-4 w-px bg-border opacity-50" />
        <span className="text-xs text-muted-foreground font-medium">
          {currentOrg ? currentOrg.name : "Personal Workspace"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Workspace Notifications Bell */}
        <NotificationBell />

        {user && (
          <div className="flex items-center gap-2.5 pl-2 border-l border-border">
            {/* User identity & copy email */}
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-xs font-semibold text-foreground leading-tight">
                {user.name}
              </span>
              <button
                type="button"
                onClick={handleCopyEmail}
                title="Click to copy invite email"
                className="group flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <span className="max-w-[150px] truncate">{user.email}</span>
                {copiedEmail ? (
                  <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
                )}
              </button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              title="Sign out"
              className="h-9 w-9 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
