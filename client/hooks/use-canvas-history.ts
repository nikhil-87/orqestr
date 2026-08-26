import { useCallback, useEffect, useRef, useState } from "react";
import { Edge, Node } from "@xyflow/react";
import { AgentNodeData } from "@/lib/types";

type HistorySnapshot = {
  nodes: Node<AgentNodeData>[];
  edges: Edge[];
};

export const useCanvasHistory = (
  nodes: Node<AgentNodeData>[],
  edges: Edge[],
  setNodes: (nodes: Node<AgentNodeData>[] | ((nds: Node<AgentNodeData>[]) => Node<AgentNodeData>[])) => void,
  setEdges: (edges: Edge[] | ((eds: Edge[]) => Edge[])) => void,
  maxHistory: number = 30,
) => {
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);
  const isUndoOrRedo = useRef(false);

  const takeSnapshot = useCallback(
    (newNodes?: Node<AgentNodeData>[], newEdges?: Edge[]) => {
      if (isUndoOrRedo.current) {
        isUndoOrRedo.current = false;
        return;
      }
      setPast((prev) => {
        const currentSnapshot: HistorySnapshot = {
          nodes: newNodes ?? nodes,
          edges: newEdges ?? edges,
        };
        const updated = [...prev, currentSnapshot];
        if (updated.length > maxHistory) {
          return updated.slice(updated.length - maxHistory);
        }
        return updated;
      });
      setFuture([]);
    },
    [nodes, edges, maxHistory],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    isUndoOrRedo.current = true;
    setFuture((prev) => [{ nodes, edges }, ...prev]);
    setPast(newPast);
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [past, nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    isUndoOrRedo.current = true;
    setPast((prev) => [...prev, { nodes, edges }]);
    setFuture(newFuture);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [future, nodes, edges, setNodes, setEdges]);

  // Global keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea/monaco editor
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest(".monaco-editor")
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return {
    takeSnapshot,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
};
