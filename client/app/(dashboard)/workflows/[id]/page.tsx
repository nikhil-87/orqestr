"use client";

import "@xyflow/react/dist/style.css";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  GitBranch,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
  Loader2,
  Pencil,
  Copy,
  Calendar,
  Globe,
  History,
  Activity,
  Layers,
} from "lucide-react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  MarkerType,
} from "@xyflow/react";
import { toast } from "sonner";
import dynamic from "next/dynamic";

import {
  useWorkflow,
  useTriggerRun,
  useDeleteWorkflow,
  useDuplicateWorkflow,
} from "@/hooks/use-workflow";
import { formatDate } from "@/lib/utils/date";
import AgentNode from "@/components/workflows/builder/AgentNode";
import ErrorState from "@/components/ui/ErrorState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AgentNodeData, WorkflowDefinition } from "@/lib/types";
import { cn } from "@/lib/utils";

import ScheduleTab from "@/components/workflows/tabs/ScheduleTab";
import WebhookTab from "@/components/workflows/tabs/WebhookTab";
import VersionHistoryTab from "@/components/workflows/tabs/VersionHistoryTab";
import ExecutionHistoryTab from "@/components/workflows/tabs/ExecutionHistoryTab";

const defaultEdgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: "#a1a1aa",
};

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const nodeTypes = { agentNode: AgentNode };

type TabKey = "graph" | "runs" | "schedules" | "webhooks" | "versions";

const WorkflowDetailContent = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabKey>("graph");

  const {
    data: workflowData,
    isLoading: workflowLoading,
    error: workflowError,
    refetch: refetchWorkflow,
  } = useWorkflow(id);

  const { mutateAsync: triggerRun, isPending } = useTriggerRun();
  const { mutateAsync: deleteWorkflow, isPending: isDeleting } = useDeleteWorkflow();
  const { mutateAsync: duplicateWorkflow, isPending: isDuplicating } = useDuplicateWorkflow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inputJson, setInputJson] = useState("{\n  \n}");

  const workflow = workflowData?.data;

  // Build canvas from workflow definition
  useEffect(() => {
    if (!workflow) return;

    let definition = workflow.definition as any;
    if (typeof definition === "string") {
      try {
        definition = JSON.parse(definition);
      } catch {
        return;
      }
    }
    if (!definition?.nodes || !Array.isArray(definition.nodes)) return;

    const flowNodes: Node<AgentNodeData>[] = definition.nodes.map((node: any, index: number) => {
      const savedPos = (node as any).position;
      const position =
        savedPos && typeof savedPos.x === "number" && typeof savedPos.y === "number"
          ? savedPos
          : { x: 100 + 400 * index, y: 100 };

      return {
        id: node.id,
        type: "agentNode",
        position,
        data: {
          label: node.name,
          type: node.type,
          config: node.config,
          critical: node.critical,
          status: "idle",
          readOnly: true,
        } as AgentNodeData & { readOnly: boolean },
      };
    });

    const flowEdges: Edge[] = (definition.edges ?? []).map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: false,
      style: { stroke: "#71717a", strokeWidth: 2 },
      markerEnd: defaultEdgeMarker,
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [workflow, setNodes, setEdges]);

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

  const handleDuplicate = async () => {
    try {
      const result = await duplicateWorkflow(id);
      toast.success("Workflow duplicated successfully");
      router.push("/workflows");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to duplicate workflow";
      toast.error(msg);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWorkflow(id);
      toast.success("Workflow deleted successfully");
      router.push("/workflows");
    } catch {
      toast.error("Failed to delete workflow");
    }
  };

  if (workflowLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (workflowError) {
    return (
      <ErrorState
        title="Failed to load workflow"
        description="Could not retrieve workflow details. Please try again."
        onRetry={() => router.refresh()}
      />
    );
  }

  if (!workflow) return null;

  const tabs: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "graph", label: "Workflow Graph", icon: Layers },
    { key: "runs", label: "Execution History", icon: Activity },
    { key: "schedules", label: "Schedules", icon: Calendar },
    { key: "webhooks", label: "Inbound Webhooks", icon: Globe },
    { key: "versions", label: "Version Snapshots", icon: History },
  ];

  return (
    <>
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 pb-12">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <Link
              href="/workflows"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card transition-all hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">{workflow.name}</h1>
                <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  v{workflow.version ?? 1}
                </span>
              </div>

              {workflow.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {workflow.description}
                </p>
              )}

              <div className="flex items-center gap-4 pt-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  <span>{workflow.definition?.nodes?.length ?? 0} nodes</span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  <span className="font-mono tabular-nums">Created {formatDate(workflow.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDuplicate}
              disabled={isDuplicating}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
            >
              {isDuplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Duplicate
            </button>

            <Link
              href={`/workflows/${id}/edit`}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:bg-accent active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4" />
              Edit Workflow
            </Link>

            <button
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-all duration-300 hover:bg-red-500/20 active:scale-[0.98]"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>

            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card-foreground px-4 py-2 text-sm font-medium text-background transition-all duration-300 hover:scale-[1.03] hover:bg-white hover:shadow-lg active:scale-[0.98]"
            >
              <Play className="h-4 w-4 fill-current" />
              Run Workflow
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border">
          <div className="flex gap-2 overflow-x-auto pb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-all whitespace-nowrap",
                    isActive
                      ? "border-primary text-foreground bg-primary/5 rounded-t-xl"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Contents */}
        {activeTab === "graph" && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium text-foreground">Interactive Canvas Preview</h2>
              <Link
                href={`/workflows/${id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
                Edit in Builder
              </Link>
            </div>

            <div className="h-120">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background />
              </ReactFlow>
            </div>
          </div>
        )}

        {activeTab === "runs" && (
          <ExecutionHistoryTab
            workflowId={id}
            onTriggerRun={() => setModalOpen(true)}
          />
        )}

        {activeTab === "schedules" && (
          <ScheduleTab workflowId={id} />
        )}

        {activeTab === "webhooks" && (
          <WebhookTab workflowId={id} />
        )}

        {activeTab === "versions" && (
          <VersionHistoryTab
            workflowId={id}
            currentVersion={workflow.version ?? 1}
            onVersionRestored={() => {
              refetchWorkflow();
              setActiveTab("graph");
            }}
          />
        )}
      </section>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
          <DialogHeader>
            <DialogTitle>Delete Workflow</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete <span className="font-semibold text-foreground">{workflow.name}</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(false)}
              className="rounded-xl border-border text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={handleDelete}
              className="rounded-xl text-xs"
            >
              {isDeleting ? "Deleting..." : "Delete Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <span className="font-medium text-foreground">{workflow.name}</span>
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
                className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                disabled={isPending}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-card-foreground px-4 py-2 text-sm font-semibold text-background transition-all hover:bg-white disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 font-semibold fill-current" />
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

export default function WorkflowDetailPage() {
  return (
    <ReactFlowProvider>
      <WorkflowDetailContent />
    </ReactFlowProvider>
  );
}
