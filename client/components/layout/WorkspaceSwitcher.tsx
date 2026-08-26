"use client";

import { useState, useRef, useEffect } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  Plus,
  Settings,
  User,
  Shield,
} from "lucide-react";
import { useCurrentOrg } from "@/providers/organization-provider";
import CreateOrgModal from "../organization/CreateOrgModal";
import OrganizationModal from "../organization/OrganizationModal";

export default function WorkspaceSwitcher() {
  const {
    currentOrgId,
    currentOrg,
    organizations,
    userRole,
    switchOrganization,
    createModalOpen,
    setCreateModalOpen,
    settingsModalOpen,
    setSettingsModalOpen,
  } = useCurrentOrg();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <div ref={dropdownRef} className="relative px-3 py-2">
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-2 text-left transition-all hover:bg-sidebar-accent hover:border-sidebar-border/80"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-card/60">
              {currentOrg ? (
                <Building2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold tracking-tight text-sidebar-foreground">
                {currentOrg ? currentOrg.name : "Personal Workspace"}
              </span>
              <span className="block text-[10px] text-muted-foreground uppercase font-medium">
                {currentOrg && userRole ? userRole : "Default"}
              </span>
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-sidebar-foreground" />
        </button>

        {/* Dropdown Menu */}
        {dropdownOpen && (
          <div className="absolute left-3 right-3 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-sidebar-border bg-popover p-1.5 shadow-2xl backdrop-blur-xl">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Workspaces
            </div>

            {/* Personal Workspace Item */}
            <button
              type="button"
              onClick={() => {
                switchOrganization(null);
                setDropdownOpen(false);
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-popover-foreground transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Personal Workspace</span>
              </div>
              {!currentOrgId && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>

            {/* Organization Workspaces */}
            {organizations.length > 0 && (
              <div className="my-1 max-h-48 overflow-y-auto border-t border-border pt-1">
                {organizations.map((org) => {
                  const isSelected = currentOrgId === org.id;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => {
                        switchOrganization(org.id);
                        setDropdownOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-popover-foreground transition-colors hover:bg-accent"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{org.name}</span>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Actions */}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  setCreateModalOpen(true);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Workspace</span>
              </button>

              {currentOrg && (
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    setSettingsModalOpen(true);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Workspace & Team</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateOrgModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
      <OrganizationModal open={settingsModalOpen} onOpenChange={setSettingsModalOpen} />
    </>
  );
}
