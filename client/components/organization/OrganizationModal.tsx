"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  Users,
  ShieldCheck,
  UserPlus,
  Trash2,
  Loader2,
  Mail,
  Calendar,
  AlertTriangle,
  LogOut,
  ChevronDown,
  Copy,
  Pencil,
  Check,
  Info,
  Shield,
  CheckCircle2,
  Lock,
  ShieldAlert,
  User,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useAddMember,
  useUpdateMemberRole,
  useRemoveMember,
  useDeleteOrganization,
  useUpdateOrganization,
  type OrgRole,
  type OrganizationMember,
} from "@/hooks/use-organization";
import { useCurrentOrg } from "@/providers/organization-provider";
import { useAuth } from "@/providers/auth-provider";
import RoleSelect, { ROLE_DEFINITIONS, type RoleOption } from "./RoleSelect";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

type OrganizationModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function OrganizationModal({ open, onOpenChange }: OrganizationModalProps) {
  const { user } = useAuth();
  const { currentOrg, userRole, isOwner, isAdmin, switchOrganization } = useCurrentOrg();

  const [activeTab, setActiveTab] = useState<"members" | "permissions" | "settings">("members");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("MEMBER");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const { mutateAsync: addMember, isPending: isAdding } = useAddMember();
  const { mutateAsync: updateRole, isPending: isUpdatingRole } = useUpdateMemberRole();
  const { mutateAsync: removeMember, isPending: isRemoving } = useRemoveMember();
  const { mutateAsync: deleteOrg, isPending: isDeletingOrg } = useDeleteOrganization();
  const { mutateAsync: updateOrg, isPending: isUpdatingOrg } = useUpdateOrganization();

  useEffect(() => {
    if (currentOrg) {
      setEditName(currentOrg.name);
      setEditSlug(currentOrg.slug);
    }
  }, [currentOrg]);

  if (!currentOrg) return null;

  const members: OrganizationMember[] = currentOrg.members ?? [];

  const handleCopyEmail = () => {
    if (!user?.email) return;
    navigator.clipboard.writeText(user.email);
    setCopiedEmail(true);
    toast.success("Invite email copied to clipboard");
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      toast.error("User email is required");
      return;
    }

    try {
      await addMember({
        orgId: currentOrg.id,
        data: {
          email: inviteEmail.trim(),
          role: inviteRole,
        },
      });
      toast.success(`Invited ${inviteEmail.trim()} to ${currentOrg.name}`);
      setInviteEmail("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to invite member";
      toast.error(msg);
    }
  };

  const handleRoleChange = async (targetUserId: string, newRole: OrgRole) => {
    try {
      await updateRole({
        orgId: currentOrg.id,
        userId: targetUserId,
        role: newRole,
      });
      toast.success("Member role updated");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update role";
      toast.error(msg);
    }
  };

  const handleRemoveMember = async (targetUserId: string, memberName: string) => {
    if (!confirm(`Are you sure you want to remove ${memberName} from this workspace?`)) {
      return;
    }

    try {
      await removeMember({
        orgId: currentOrg.id,
        userId: targetUserId,
      });
      toast.success(`Removed ${memberName} from workspace`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove member";
      toast.error(msg);
    }
  };

  const handleLeaveOrg = async () => {
    if (!user?.id) return;
    if (!confirm(`Are you sure you want to leave ${currentOrg.name}?`)) {
      return;
    }

    try {
      await removeMember({
        orgId: currentOrg.id,
        userId: user.id,
      });
      toast.success(`You left ${currentOrg.name}`);
      onOpenChange(false);
      switchOrganization(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to leave workspace";
      toast.error(msg);
    }
  };

  const handleUpdateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast.error("Workspace name cannot be empty");
      return;
    }

    try {
      await updateOrg({
        orgId: currentOrg.id,
        data: {
          name: editName.trim(),
          slug: editSlug.trim() ? editSlug.trim() : undefined,
        },
      });
      toast.success("Workspace settings updated successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update workspace";
      toast.error(msg);
    }
  };

  const handleDeleteOrg = async () => {
    try {
      await deleteOrg(currentOrg.id);
      toast.success(`Workspace "${currentOrg.name}" deleted`);
      setDeleteConfirmOpen(false);
      onOpenChange(false);
      switchOrganization(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete workspace";
      toast.error(msg);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-border bg-card p-5 sm:p-6 shadow-2xl">
          <DialogHeader className="shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight truncate">
                    {currentOrg.name}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                    <span>slug: <span className="font-mono text-foreground">{currentOrg.slug}</span></span>
                    {userRole && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("permissions")}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase shrink-0 transition-colors cursor-pointer"
                        title="Click to view what your role allows you to do"
                      >
                        <span>{userRole}</span>
                        <Info className="h-3 w-3" />
                      </button>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Invite Email Banner */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 mr-2">
                <span className="text-[11px] text-muted-foreground block">
                  Your invite email (share with team admins):
                </span>
                <span className="font-semibold text-foreground truncate block">
                  {user?.email}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyEmail}
                className="h-7 shrink-0 gap-1.5 rounded-lg border-border text-xs cursor-pointer hover:bg-primary/10"
              >
                {copiedEmail ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiedEmail ? "Copied" : "Copy"}
              </Button>
            </div>

            {/* Tab switchers in Main Position */}
            <div className="mt-3 flex gap-2 border-b border-border pb-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab("members")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                  activeTab === "members"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="h-3.5 w-3.5" />
                Team Members ({members.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("permissions")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                  activeTab === "permissions"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Shield className="h-3.5 w-3.5" />
                Role Permissions
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                    activeTab === "settings"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Workspace Settings
                </button>
              )}
            </div>
          </DialogHeader>

          {/* Scrollable Container with Constrained Height */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 mt-3">
            {activeTab === "members" && (
              <div className="space-y-4">
                {/* Invite Member form (Admin or Owner only) */}
                {isAdmin && (
                  <form
                    onSubmit={handleAddMember}
                    className="rounded-xl border border-border bg-secondary/20 p-3.5 w-full space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <UserPlus className="h-3.5 w-3.5 text-primary" />
                        <h4 className="text-xs font-semibold text-foreground">Invite New Member</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("permissions")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                        title="View what each role can do"
                      >
                        <Info className="h-3.5 w-3.5 text-primary" />
                        <span>Role Permissions Guide</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 w-full">
                      <div className="sm:col-span-6 min-w-0">
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="colleague@company.com"
                          className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-1.5 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary"
                        />
                      </div>
                      <div className="sm:col-span-3 min-w-0">
                        <RoleSelect
                          value={inviteRole as RoleOption}
                          onChange={(role) => setInviteRole(role as OrgRole)}
                          options={["MEMBER", "ADMIN"]}
                          align="start"
                          className="w-full"
                        />
                      </div>
                      <div className="sm:col-span-3 min-w-0">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isAdding || !inviteEmail.trim()}
                          className="w-full cursor-pointer rounded-xl bg-card-foreground text-xs font-medium text-background hover:bg-white disabled:opacity-50"
                        >
                          {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : "Invite"}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}

                {/* Members List with strict inner scrollbar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Active Members ({members.length})
                    </h4>
                    {members.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">Scroll to view all</span>
                    )}
                  </div>

                  <div className="max-h-52 sm:max-h-56 overflow-y-auto divide-y divide-border rounded-xl border border-border bg-secondary/10 w-full">
                    {members.map((member) => {
                      const isSelf = member.userId === user?.id;
                      const canManage = isOwner && !isSelf;
                      const canRemove =
                        (isOwner || (isAdmin && member.role === "MEMBER")) && !isSelf;

                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 transition-colors hover:bg-secondary/20 gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary font-semibold text-xs text-foreground">
                              {member.user?.name ? member.user.name.charAt(0).toUpperCase() : "U"}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-foreground truncate block">
                                  {member.user?.name || "Anonymous User"}
                                </span>
                                {isSelf && (
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab("permissions")}
                                    className="text-[10px] text-primary hover:underline shrink-0 cursor-pointer"
                                    title="View your permissions"
                                  >
                                    (You · View Permissions)
                                  </button>
                                )}
                              </div>
                              <span className="text-[11px] text-muted-foreground truncate block max-w-[180px] sm:max-w-xs">
                                {member.user?.email}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Role display or dropdown */}
                            {canManage ? (
                              <RoleSelect
                                value={member.role as RoleOption}
                                disabled={isUpdatingRole}
                                onChange={(role) =>
                                  handleRoleChange(member.userId, role as OrgRole)
                                }
                                size="sm"
                                align="end"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActiveTab("permissions")}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0 cursor-pointer transition-opacity hover:opacity-80",
                                  ROLE_DEFINITIONS[member.role as RoleOption]?.badgeClass ||
                                    "border-border bg-secondary/40 text-muted-foreground"
                                )}
                                title={`View ${member.role} permissions`}
                              >
                                {member.role}
                              </button>
                            )}

                            {/* Remove button */}
                            {canRemove && (
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isRemoving}
                                onClick={() =>
                                  handleRemoveMember(member.userId, member.user?.name || "Member")
                                }
                                title="Remove member"
                                className="h-7 w-7 text-muted-foreground hover:text-red-400 shrink-0 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Leave Workspace Button for non-owners */}
                {!isOwner && (
                  <div className="pt-2 border-t border-border flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLeaveOrg}
                      className="rounded-xl border-border text-xs text-red-400 hover:bg-red-500/10 hover:border-red-500/30 cursor-pointer"
                    >
                      <LogOut className="mr-1.5 h-3.5 w-3.5" />
                      Leave Workspace
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Dedicated Role Permissions Tab in Main Position */}
            {activeTab === "permissions" && (
              <div className="space-y-4 animate-in fade-in-50 duration-150">
                {/* Active user role status card */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">
                        Your Assigned Role in this Workspace
                      </span>
                    </div>
                    {userRole && (
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase",
                          ROLE_DEFINITIONS[userRole as RoleOption]?.badgeClass ||
                            "border-primary/30 bg-primary/10 text-primary"
                        )}
                      >
                        {userRole}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    You are currently authenticated as an active{" "}
                    <strong className="text-foreground">{userRole || "MEMBER"}</strong>. Below is a
                    breakdown of the exact capabilities and permissions for your account.
                  </p>

                  {/* Allowed actions */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      What you are allowed to do:
                    </span>
                    <ul className="space-y-1 text-xs text-muted-foreground pl-5 list-disc">
                      {userRole === "MEMBER" && (
                        <>
                          <li>Build, configure, and edit all workflows in this workspace.</li>
                          <li>Execute workflow runs and monitor live execution progress.</li>
                          <li>View complete execution logs, run durations, and task results.</li>
                          <li>Inspect historical snapshots and version audit history.</li>
                        </>
                      )}
                      {userRole === "ADMIN" && (
                        <>
                          <li>All Member permissions (build, edit, duplicate, and execute workflows).</li>
                          <li>Invite new team members by email address.</li>
                          <li>Assign and manage Member and Admin roles.</li>
                          <li>Remove members from the workspace.</li>
                          <li>Configure automated recurring workflow schedules and cron triggers.</li>
                          <li>Set up inbound webhooks and regenerate secret tokens.</li>
                          <li>Update workspace display name and URL slug.</li>
                        </>
                      )}
                      {userRole === "OWNER" && (
                        <>
                          <li>Full, unrestricted administrative ownership of the workspace.</li>
                          <li>Invite, promote, demote, and remove any team member.</li>
                          <li>Transfer workspace ownership or permanently delete the workspace.</li>
                          <li>Manage all workspace settings, webhooks, schedules, and workflows.</li>
                        </>
                      )}
                    </ul>
                  </div>

                  {/* Restricted actions */}
                  {userRole !== "OWNER" && (
                    <div className="space-y-1.5 pt-2 border-t border-primary/15">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-zinc-400" />
                        Restricted actions:
                      </span>
                      <ul className="space-y-1 text-xs text-muted-foreground pl-5 list-disc">
                        {userRole === "MEMBER" && (
                          <>
                            <li>Inviting new members or managing team roles (Requires Admin or Owner).</li>
                            <li>Configuring recurring schedules or webhooks (Requires Admin or Owner).</li>
                            <li>Renaming workspace or deleting workspace (Requires Admin or Owner).</li>
                          </>
                        )}
                        {userRole === "ADMIN" && (
                          <>
                            <li>Deleting workspace or transferring workspace ownership (Requires Owner).</li>
                          </>
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Complete Roles Matrix Comparison */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Workspace Roles Matrix
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* OWNER */}
                    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-[9px] font-bold text-purple-400 uppercase">
                          OWNER
                        </span>
                        <ShieldAlert className="h-3.5 w-3.5 text-purple-400" />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Full workspace authority. Can manage billing, delete workspace, and assign any role.
                      </p>
                    </div>

                    {/* ADMIN */}
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-[9px] font-bold text-blue-400 uppercase">
                          ADMIN
                        </span>
                        <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Team & workflow management. Can invite members, assign roles, manage schedules and webhooks.
                      </p>
                    </div>

                    {/* MEMBER */}
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400 uppercase">
                          MEMBER
                        </span>
                        <User className="h-3.5 w-3.5 text-emerald-400" />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Collaborator. Can build, edit, duplicate, execute workflows, and view runs and snapshots.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {activeTab === "settings" && isAdmin && (
            <div className="mt-4 space-y-5">
              {/* Workspace Rename / Slug Form */}
              <form onSubmit={handleUpdateOrg} className="rounded-xl border border-border bg-secondary/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold text-foreground">Edit Workspace Details</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Workspace Name</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Workspace Slug</label>
                    <input
                      type="text"
                      required
                      value={editSlug}
                      onChange={(e) => setEditSlug(e.target.value)}
                      className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isUpdatingOrg || !editName.trim()}
                    className="cursor-pointer rounded-xl bg-card-foreground text-xs font-semibold text-background hover:bg-white"
                  >
                    {isUpdatingOrg ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Changes"}
                  </Button>
                </div>
              </form>

              {/* Overview */}
              <div className="rounded-xl border border-border bg-secondary/10 p-4 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Workspace Overview</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <span className="block font-medium text-foreground">Workspace ID:</span>
                    <span className="font-mono text-[11px] truncate block">{currentOrg.id}</span>
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">Created:</span>
                    <span className="font-mono tabular-nums">{formatDate(currentOrg.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Danger Zone (Owner only) */}
              {isOwner && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <h4 className="text-xs font-semibold">Danger Zone</h4>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Deleting this workspace will permanently remove it and all member associations.
                    Workflows created inside this workspace will be deleted.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="rounded-xl text-xs cursor-pointer"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete Workspace
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
      </Dialog>

      {/* Delete Workspace Confirmation Sub-Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-red-400">
              Confirm Delete Workspace
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{currentOrg.name}</span>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(false)}
              className="rounded-xl border-border text-xs cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeletingOrg}
              onClick={handleDeleteOrg}
              className="rounded-xl text-xs cursor-pointer"
            >
              {isDeletingOrg ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
