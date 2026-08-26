"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";

import type { Connection, Edge, Node } from "@xyflow/react";

import NodeConfigPanel from "@/components/workflows/builder/NodeConfigPanel";
import BuilderTopbar from "@/components/workflows/builder/BuilderTopbar";
import NodePalette from "@/components/workflows/builder/NodePalette";
import AgentNode from "@/components/workflows/builder/AgentNode";
import RemovableEdge from "@/components/workflows/builder/RemovableEdge";
import { AuthModal } from "@/components/auth/auth-modal";
import { useCreateWorkflow } from "@/hooks/use-workflow";
import { useAuth } from "@/providers/auth-provider";
import { AgentNodeData, AgentType } from "@/lib/types";
import { useCanvasHistory } from "@/hooks/use-canvas-history";
import { getLayoutedElements } from "@/lib/utils/auto-layout";
import { validateWorkflowGraph } from "@/lib/utils/workflow-validator";

const nodeTypes = { agentNode: AgentNode };
const edgeTypes = { removable: RemovableEdge, default: RemovableEdge };
import { AGENT_LABELS } from "@/lib/constants/agent.constants";

const defaultEdgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: "#a1a1aa",
};

let nodeCounter = 0;
const getId = () => `node_${Date.now()}_${nodeCounter++}`;

const DRAFT_STORAGE_KEY = "orqestr_draft_workflow";

const NewWorkflowContent = () => {
  const router = useRouter();
  const { user } = useAuth();
  const { mutateAsync: createWorkflow, isPending } = useCreateWorkflow();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<AgentNodeData> | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const { takeSnapshot, undo, redo, canUndo, canRedo } = useCanvasHistory(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

  // Restore draft on mount if available
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.name) setWorkflowName(parsed.name);
        if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) setNodes(parsed.nodes);
        if (Array.isArray(parsed.edges) && parsed.edges.length > 0) {
          setEdges(
            parsed.edges.map((e: Edge) => ({
              ...e,
              markerEnd: defaultEdgeMarker,
            })),
          );
        }
        toast.info("Restored your unsaved workflow draft");
      }
    } catch {
      // Ignore parse errors
    }
  }, [setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      takeSnapshot();
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "removable",
            animated: true,
            style: { stroke: "#71717a", strokeWidth: 2 },
            markerEnd: defaultEdgeMarker,
          },
          eds,
        ),
      );
    },
    [setEdges, takeSnapshot],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      takeSnapshot();
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
    },
    [setEdges, takeSnapshot],
  );

  const onReconnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      takeSnapshot();
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges, takeSnapshot],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData(
        "application/reactflow",
      ) as AgentType;

      if (!type) return;

      takeSnapshot();

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node<AgentNodeData> = {
        id: getId(),
        type: "agentNode",
        position,
        data: {
          label: AGENT_LABELS[type] || "New Agent",
          type,
          config: {},
          critical: true,
          status: "idle",
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes, takeSnapshot],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<AgentNodeData>) => {
      setSelectedNode(node);
    },
    [],
  );

  const onConfigSave = useCallback(
    (nodeId: string, updatedData: AgentNodeData) => {
      takeSnapshot();
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updatedData,
                },
              }
            : node,
        ),
      );
      setSelectedNode(null);
      toast.success("Node configuration saved");
    },
    [setNodes, takeSnapshot],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      takeSnapshot();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNode?.id === nodeId) {
        setSelectedNode(null);
      }
      toast.info("Node deleted");
    },
    [selectedNode, setNodes, setEdges, takeSnapshot],
  );

  const onNodesDelete = useCallback(
    (deletedNodes: Node<AgentNodeData>[]) => {
      takeSnapshot();
      const deletedIds = new Set(deletedNodes.map((n) => n.id));
      setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
      if (selectedNode && deletedIds.has(selectedNode.id)) {
        setSelectedNode(null);
      }
      toast.info("Node deleted");
    },
    [selectedNode, setEdges, takeSnapshot],
  );

  const handleAutoLayout = useCallback(() => {
    takeSnapshot();
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      "LR",
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
    toast.success("Graph auto-arranged");
  }, [nodes, edges, setNodes, setEdges, fitView, takeSnapshot]);

  const handleExportJson = useCallback(() => {
    const exportData = {
      $schema: "https://orqestr.com/schema/v1/workflow.json",
      name: workflowName,
      description: "Exported Orqestr workflow pipeline",
      definition: {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.data.type,
          name: node.data.label,
          critical: node.data.critical,
          config: node.data.config,
          position: node.position,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Workflow JSON downloaded");
  }, [workflowName, nodes, edges]);

  const handleImportJson = useCallback(
    (imported: { name?: string; description?: string; definition: any }) => {
      takeSnapshot();
      if (imported.name) setWorkflowName(imported.name);
      const def = imported.definition;
      if (!def?.nodes || !Array.isArray(def.nodes)) {
        toast.error("Invalid workflow JSON: missing nodes array");
        return;
      }

      const newNodes: Node<AgentNodeData>[] = def.nodes.map((n: any, idx: number) => ({
        id: n.id || `node_${Date.now()}_${idx}`,
        type: "agentNode",
        position: n.position || { x: 100 + 400 * idx, y: 150 },
        data: {
          label: n.name || "Agent",
          type: n.type,
          config: n.config || {},
          critical: n.critical ?? true,
          status: "idle",
        },
      }));

      const newEdges: Edge[] = (def.edges || []).map((e: any) => ({
        id: e.id || `e_${e.source}_${e.target}`,
        source: e.source,
        target: e.target,
        type: "removable",
        style: { stroke: "#71717a", strokeWidth: 2 },
        markerEnd: defaultEdgeMarker,
      }));

      setNodes(newNodes);
      setEdges(newEdges);
      setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
    },
    [setNodes, setEdges, fitView, takeSnapshot],
  );

  const performSave = async () => {
    // Run pre-save graph validation
    const validation = validateWorkflowGraph(nodes, edges);
    if (!validation.isValid) {
      toast.error(validation.blockingErrors[0]);
      return;
    }

    try {
      const definition = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.data.type,
          name: node.data.label,
          critical: node.data.critical,
          config: node.data.config,
          position: node.position,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      };

      await createWorkflow({
        name: workflowName,
        definition,
      });

      // Clear draft on successful persistence
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      toast.success("Workflow saved successfully");
      router.push("/workflows");
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to save workflow";
      toast.error(errorMessage);
    }
  };

  const handleSaveClick = async () => {
    if (!user) {
      try {
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            name: workflowName,
            nodes,
            edges,
          }),
        );
      } catch {
        // Storage quota exceeded or disabled
      }
      setAuthModalOpen(true);
      return;
    }

    await performSave();
  };

  const canSave = useMemo(() => nodes.length > 0, [nodes]);

  return (
    <div className="h-screen overflow-hidden bg-background">
      <BuilderTopbar
        workflowName={workflowName}
        setWorkflowName={setWorkflowName}
        canSave={canSave}
        onSave={handleSaveClick}
        isSaving={isPending}
        onUndo={undo}
        canUndo={canUndo}
        onRedo={redo}
        canRedo={canRedo}
        onAutoLayout={handleAutoLayout}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
      />

      <NodePalette />

      <div className="ml-65 mt-16 h-[calc(100vh-4rem)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          edgesReconnectable={true}
          deleteKeyCode={["Backspace", "Delete"]}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls className="bg-card! border-border! [&>button]:bg-card! [&>button]:border-border! [&>button]:text-foreground! [&>button:hover]:bg-accent!" />
          <MiniMap className="bg-card!" nodeColor="#3f3f46" maskColor="rgba(0,0,0,0.6)" />
        </ReactFlow>
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onSave={onConfigSave}
          onDelete={handleDeleteNode}
        />
      )}

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={async () => {
          setAuthModalOpen(false);
          await performSave();
        }}
      />
    </div>
  );
};

export default function NewWorkflowPage() {
  return (
    <ReactFlowProvider>
      <NewWorkflowContent />
    </ReactFlowProvider>
  );
}
