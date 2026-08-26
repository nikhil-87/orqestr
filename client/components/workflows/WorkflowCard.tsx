"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, GitBranch, Loader2, Play, Pencil, Copy } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useTriggerRun, useDuplicateWorkflow } from "@/hooks/use-workflow";
import { formatDate } from "@/lib/utils/date";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

type WorkflowCardProps = {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  createdAt: string;
};

const WorkflowCard = ({
  id,
  name,
  description,
  nodeCount,
  createdAt,
}: WorkflowCardProps) => {
  const router = useRouter();
  const { mutateAsync: triggerRun, isPending } = useTriggerRun();
  const { mutateAsync: duplicateWorkflow, isPending: isDuplicating } = useDuplicateWorkflow();
  const [modalOpen, setModalOpen] = useState(false);
  const [inputJson, setInputJson] = useState("{\n  \n}");

  const handleRun = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  };

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await duplicateWorkflow(id);
      toast.success("Workflow duplicated successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to duplicate workflow";
      toast.error(msg);
    }
  };

  const handleExecute = async () => {
    try {
      const input = JSON.parse(inputJson);
      const result = await triggerRun({ id, input });
      toast.success("Workflow triggered successfully");
      setModalOpen(false);
      const runId = result?.data?.runId ?? (result as any)?.runId;
      if (runId) {
        router.push(`/runs/${runId}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        toast.error("Invalid JSON input");
      } else {
        toast.error("Failed to trigger workflow");
      }
    }
  };
  const handleCardClick = (e: React.MouseEvent) => {
    // If the click is on an interactive element, do not trigger card navigation
    if ((e.target as HTMLElement).closest("a, button")) {
      return;
    }
    router.push(`/workflows/${id}`);
  };

  return (
    <>
      <div
        onClick={handleCardClick}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border bg-card/80 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-card"
      >
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/3 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        <div className="flex h-full flex-col justify-between gap-6">
          {/* Top */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Link
                  href={`/workflows/${id}`}
                  className="line-clamp-1 text-lg font-semibold tracking-tight transition-colors hover:text-primary"
                >
                  {name}
                </Link>
                <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {description ?? "No workflow description provided."}
                </p>
              </div>

              <Link
                href={`/workflows/${id}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          {/* Bottom */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/80 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1 text-xs font-medium text-muted-foreground shrink-0">
                <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>
                  {nodeCount} node{nodeCount !== 1 ? "s" : ""}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground shrink-0">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span>{formatDate(createdAt)}</span>
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={isDuplicating}
                title="Duplicate workflow"
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95"
              >
                {isDuplicating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Duplicate</span>
              </button>

              <Link
                href={`/workflows/${id}/edit`}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit</span>
              </Link>

              <button
                type="button"
                onClick={handleRun}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Run</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Run Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Trigger Run</h2>
              <p className="text-sm text-muted-foreground">
                Provide the JSON input payload for{" "}
                <span className="font-medium text-foreground">{name}</span>
              </p>
            </div>

            {/* Editor */}
            <div className="mt-5 overflow-hidden rounded-xl border border-border">
              <MonacoEditor
                height="200px"
                language="json"
                theme="vs-dark"
                value={inputJson}
                onChange={(val) => setInputJson(val ?? "{}")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "off",
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                }}
              />
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-card-foreground px-4 py-2 text-sm font-semibold text-background transition-all hover:bg-white disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 font-semibold" />
                )}
                {isPending ? "Triggering..." : "Execute"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default WorkflowCard;
