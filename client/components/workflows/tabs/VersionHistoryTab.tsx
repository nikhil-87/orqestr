"use client";

import { useState } from "react";
import {
  History,
  RotateCcw,
  Loader2,
  Calendar,
  Layers,
  Eye,
  CheckCircle2,
  GitCommit,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflowVersions,
  useRestoreWorkflowVersion,
  type WorkflowVersionItem,
} from "@/hooks/use-workflow";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/date";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type VersionHistoryTabProps = {
  workflowId: string;
  currentVersion: number;
  onVersionRestored?: () => void;
};

export default function VersionHistoryTab({
  workflowId,
  currentVersion,
  onVersionRestored,
}: VersionHistoryTabProps) {
  const { data: versionsData, isLoading, refetch } = useWorkflowVersions(workflowId);
  const { mutateAsync: restoreVersion, isPending: isRestoring } = useRestoreWorkflowVersion();

  const versions: WorkflowVersionItem[] = (versionsData?.data as any)?.data ?? versionsData?.data ?? [];

  const [selectedVersion, setSelectedVersion] = useState<WorkflowVersionItem | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<WorkflowVersionItem | null>(null);

  const handleRestore = async () => {
    if (!selectedVersion) return;
    try {
      await restoreVersion({
        workflowId,
        version: selectedVersion.version,
      });
      toast.success(`Restored snapshot from v${selectedVersion.version} as latest version`);
      setRestoreDialogOpen(false);
      setSelectedVersion(null);
      refetch();
      if (onVersionRestored) onVersionRestored();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to restore version";
      toast.error(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground">Version Snapshots</h3>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              Active: v{currentVersion}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Every update creates an immutable snapshot. Restoring a prior version creates a new latest version without overwriting history.
          </p>
        </div>
      </div>

      {/* Version List */}
      {versions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground">
            <GitCommit className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">No Historical Snapshots Yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Historical snapshots are created automatically whenever you edit and save changes to this workflow.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((ver) => {
            const definition = ver.definition as { nodes?: unknown[]; edges?: unknown[] };
            const nodeCount = definition?.nodes?.length ?? 0;
            const edgeCount = definition?.edges?.length ?? 0;
            const isCurrent = ver.version === currentVersion;

            return (
              <div
                key={ver.id || ver.version}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-card/80 p-5 transition-all hover:bg-card sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      v{ver.version}
                    </span>
                    <h4 className="text-sm font-medium text-foreground">{ver.name}</h4>
                    {isCurrent && (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Current
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-mono tabular-nums">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatDateTime(ver.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      <span>
                        {nodeCount} node{nodeCount !== 1 ? "s" : ""}, {edgeCount} connection{edgeCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewVersion(ver)}
                    className="cursor-pointer rounded-xl border-border text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Inspect
                  </Button>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedVersion(ver);
                        setRestoreDialogOpen(true);
                      }}
                      className="cursor-pointer rounded-xl bg-card-foreground px-3 text-xs font-medium text-background hover:bg-white"
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inspect Version Modal */}
      <Dialog open={!!previewVersion} onOpenChange={() => setPreviewVersion(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-border bg-card p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <span>Version Snapshot v{previewVersion?.version}</span>
              <span className="text-xs font-normal text-muted-foreground">({previewVersion?.name})</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Saved on {previewVersion ? formatDateTime(previewVersion.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3 flex-1 min-h-0 overflow-hidden flex flex-col">
            <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider shrink-0">Workflow Nodes</h5>
            <div className="flex-1 min-h-0 max-h-60 overflow-y-auto rounded-xl border border-border bg-background p-3 space-y-2">
              {(() => {
                let def = previewVersion?.definition as any;
                if (typeof def === "string") {
                  try {
                    def = JSON.parse(def);
                  } catch {
                    def = null;
                  }
                }
                const nodes = Array.isArray(def?.nodes) ? def.nodes : [];
                if (nodes.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground italic py-2 text-center">
                      No nodes configured in this snapshot.
                    </p>
                  );
                }
                return nodes.map((n: any) => (
                  <div key={n.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-2.5 text-xs">
                    <div>
                      <span className="font-semibold text-foreground">{n.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">({n.type})</span>
                    </div>
                    {n.critical && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">Critical</span>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewVersion(null)}
              className="rounded-xl border-border text-xs"
            >
              Close
            </Button>
            {previewVersion && previewVersion.version !== currentVersion && (
              <Button
                size="sm"
                onClick={() => {
                  setSelectedVersion(previewVersion);
                  setPreviewVersion(null);
                  setRestoreDialogOpen(true);
                }}
                className="rounded-xl bg-card-foreground text-xs text-background hover:bg-white"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restore This Snapshot
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
          <DialogHeader>
            <DialogTitle>Restore Version {selectedVersion?.version}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Restoring this snapshot will set the workflow graph definition to match <strong>v{selectedVersion?.version}</strong> ({selectedVersion?.name}) and create a new version <strong>v{currentVersion + 1}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRestoreDialogOpen(false)}
              className="rounded-xl border-border text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isRestoring}
              onClick={handleRestore}
              className="rounded-xl bg-card-foreground text-xs font-semibold text-background hover:bg-white"
            >
              {isRestoring ? "Restoring..." : `Restore as v${currentVersion + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
