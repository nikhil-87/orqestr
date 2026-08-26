"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useOrganizations,
  useOrganization,
  type Organization,
  type OrganizationMember,
  type OrgRole,
} from "@/hooks/use-organization";
import { useAuth } from "./auth-provider";

export type OrganizationContextType = {
  currentOrgId: string | null;
  currentOrg: Organization | null;
  organizations: Organization[];
  isLoading: boolean;
  userRole: OrgRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  switchOrganization: (orgId: string | null, orgName?: string) => void;
  createModalOpen: boolean;
  setCreateModalOpen: (open: boolean) => void;
  settingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
};

const OrganizationContext = createContext<OrganizationContextType | null>(null);

const STORAGE_KEY = "currentOrganizationId";

export const OrganizationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [currentOrgId, setCurrentOrgId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && saved !== "personal" ? saved : null;
    }
    return null;
  });
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const { data: orgsData, isLoading: orgsLoading, isFetching: orgsFetching } = useOrganizations(!!user?.id);
  const organizations: Organization[] = useMemo(() => {
    const raw = (orgsData?.data as any)?.data ?? orgsData?.data ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [orgsData]);

  // Fetch detailed members if an organization is currently active
  const { data: activeOrgDetailData } = useOrganization(currentOrgId, !!user?.id);
  const activeOrgDetailed = (activeOrgDetailData?.data as any)?.data ?? activeOrgDetailData?.data;

  // Active organization object
  const currentOrg = useMemo(() => {
    if (!currentOrgId) return null;
    if (activeOrgDetailed && activeOrgDetailed.id === currentOrgId) {
      return activeOrgDetailed;
    }
    return organizations.find((o) => o.id === currentOrgId) ?? null;
  }, [currentOrgId, activeOrgDetailed, organizations]);

  // Reset active org and clear caches when user changes or logs out
  const prevUserIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => {
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== user?.id) {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
      setCurrentOrgId(null);
      queryClient.clear();
    }
    prevUserIdRef.current = user?.id;
  }, [user?.id, queryClient]);

  // Listen to organization-reset event (e.g. dispatched when backend rejects stale org with 403)
  useEffect(() => {
    const handleOrgReset = () => {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
      setCurrentOrgId(null);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
    };

    window.addEventListener("organization-reset", handleOrgReset);
    return () => window.removeEventListener("organization-reset", handleOrgReset);
  }, [queryClient]);

  // Validate active org against user's fetched orgs only when neither loading nor fetching
  useEffect(() => {
    if (!orgsLoading && !orgsFetching && currentOrgId && organizations.length > 0) {
      if (activeOrgDetailed && activeOrgDetailed.id === currentOrgId) {
        return;
      }
      const exists = organizations.some((o) => o.id === currentOrgId);
      if (!exists) {
        // Active org was deleted or user lost access
        if (typeof window !== "undefined") {
          localStorage.removeItem(STORAGE_KEY);
        }
        setCurrentOrgId(null);
      }
    }
  }, [orgsLoading, orgsFetching, currentOrgId, organizations, activeOrgDetailed]);

  // User's role in the active organization
  const userRole = useMemo<OrgRole | null>(() => {
    if (!currentOrg || !user?.id) return null;
    const member = currentOrg.members?.find((m: OrganizationMember) => m.userId === user.id);
    return member?.role ?? null;
  }, [currentOrg, user?.id]);

  const isOwner = userRole === "OWNER";
  const isAdmin = userRole === "ADMIN" || isOwner;

  const switchOrganization = useCallback(
    (orgId: string | null, orgName?: string) => {
      const normalized = orgId === "personal" || !orgId ? null : orgId;

      if (typeof window !== "undefined") {
        if (normalized) {
          localStorage.setItem(STORAGE_KEY, normalized);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      setCurrentOrgId(normalized);

      // Invalidate queries so stale data is never shown across tenants
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });

      if (normalized) {
        const targetOrg = organizations.find((o) => o.id === normalized);
        const name = orgName || targetOrg?.name || "Workspace";
        toast.info(`Switched to workspace: ${name}`);
      } else {
        toast.info("Switched to Personal Workspace");
      }
    },
    [organizations, queryClient],
  );

  return (
    <OrganizationContext.Provider
      value={{
        currentOrgId,
        currentOrg,
        organizations,
        isLoading: orgsLoading,
        userRole,
        isOwner,
        isAdmin,
        switchOrganization,
        createModalOpen,
        setCreateModalOpen,
        settingsModalOpen,
        setSettingsModalOpen,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
};

export const useCurrentOrg = () => {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useCurrentOrg must be used within an OrganizationProvider");
  }
  return context;
};
