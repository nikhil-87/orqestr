"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  useReactFlow,
} from "@xyflow/react";
import { X } from "lucide-react";
import { toast } from "sonner";

export default function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
    toast.info("Connection disconnected");
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? "#38bdf8" : style.stroke || "#71717a",
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <button
            onClick={onDisconnect}
            title="Click to disconnect nodes"
            aria-label="Disconnect connection"
            className="group flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-all duration-200 hover:scale-125 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-400 active:scale-95"
          >
            <X className="h-3 w-3 transition-transform group-hover:rotate-90" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
