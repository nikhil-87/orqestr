"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoleOption = "MEMBER" | "ADMIN" | "OWNER";

export interface RoleInfo {
  role: RoleOption;
  label: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export const ROLE_DEFINITIONS: Record<RoleOption, RoleInfo> = {
  OWNER: {
    role: "OWNER",
    label: "Owner",
    badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    icon: ShieldAlert,
    description: "Full workspace ownership, billing & settings control",
  },
  ADMIN: {
    role: "ADMIN",
    label: "Admin",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: ShieldCheck,
    description: "Invite team members, manage roles & all workflows",
  },
  MEMBER: {
    role: "MEMBER",
    label: "Member",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: User,
    description: "Build, edit, duplicate, and trigger workflows",
  },
};

interface RoleSelectProps {
  value: RoleOption;
  onChange: (role: RoleOption) => void;
  options?: RoleOption[];
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "start" | "end";
  className?: string;
}

export default function RoleSelect({
  value,
  onChange,
  options = ["MEMBER", "ADMIN", "OWNER"],
  disabled = false,
  size = "md",
  align = "end",
  className,
}: RoleSelectProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "top" | "bottom";
  } | null>(null);

  const activeDef = ROLE_DEFINITIONS[value] || ROLE_DEFINITIONS.MEMBER;
  const ActiveIcon = activeDef.icon;

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 260; // 16.25rem = ample space for descriptions
    const padding = 10;

    // Viewport dimensions
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;

    // Measure actual mounted height or estimate based on number of options (~68px per item + padding)
    const menuHeight = menuRef.current?.offsetHeight || options.length * 68 + 16;

    // Horizontal positioning & viewport edge clamping
    let left = align === "end" ? rect.right - menuWidth : rect.left;
    if (left + menuWidth > viewportWidth - padding) {
      left = viewportWidth - menuWidth - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Available space calculations
    const spaceBelow = viewportHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;

    // Determine placement: flip upwards if space below cannot fit the menu and above has more room
    const shouldFlipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    let top: number;
    let maxHeight: number;

    if (shouldFlipUp) {
      const availableAbove = Math.max(100, spaceAbove - 6);
      maxHeight = Math.min(menuHeight, availableAbove);
      top = Math.max(padding, rect.top - maxHeight - 6);
    } else {
      const availableBelow = Math.max(100, spaceBelow - 6);
      maxHeight = Math.min(menuHeight, availableBelow);
      top = rect.bottom + 6;
    }

    setCoords({
      top: Math.round(top),
      left: Math.round(left),
      width: menuWidth,
      maxHeight: Math.round(maxHeight),
      placement: shouldFlipUp ? "top" : "bottom",
    });
  }, [align, options.length]);

  // Re-measure on mount to ensure sub-pixel accuracy
  React.useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (open) {
      updatePosition();
      const handleScrollOrResize = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        // If trigger button scrolled completely off viewport, dismiss
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          setOpen(false);
          return;
        }
        updatePosition();
      };
      const handleOutsideClick = (e: MouseEvent) => {
        if (
          triggerRef.current &&
          !triggerRef.current.contains(e.target as Node) &&
          menuRef.current &&
          !menuRef.current.contains(e.target as Node)
        ) {
          setOpen(false);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };

      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleKeyDown);

      return () => {
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
        document.removeEventListener("mousedown", handleOutsideClick);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [open, updatePosition]);

  const handleSelect = (role: RoleOption) => {
    onChange(role);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-secondary/40 text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-secondary/70 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "px-2.5 py-1 text-xs" : "w-full px-3 py-1.5 text-xs",
          className
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          <ActiveIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium">{activeDef.label}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
            open && "rotate-180 text-foreground"
          )}
        />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 9999,
              transformOrigin:
                coords.placement === "top"
                  ? align === "end"
                    ? "bottom right"
                    : "bottom left"
                  : align === "end"
                  ? "top right"
                  : "top left",
            }}
            className={cn(
              "overflow-y-auto rounded-xl border border-border/80 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95",
              coords.placement === "top" ? "slide-in-from-bottom-2" : "slide-in-from-top-2"
            )}
          >
            <div className="space-y-1">
              {options.map((opt) => {
                const def = ROLE_DEFINITIONS[opt];
                const isSelected = opt === value;
                const Icon = def.icon;

                return (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt)}
                    className={cn(
                      "flex w-full cursor-pointer items-start justify-between rounded-lg p-2 text-left transition-all duration-150",
                      isSelected
                        ? "bg-secondary/70 text-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {def.label}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-0.2 text-[9px] font-semibold uppercase shrink-0",
                              def.badgeClass
                            )}
                          >
                            {opt}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {def.description}
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
