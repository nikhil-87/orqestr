"use client";

import { BrainCircuit, Globe, Shuffle } from "lucide-react";

const AGENTS = [
  {
    type: "LLM_AGENT",
    name: "LLM Agent",
    description: "Prompt-based AI reasoning and generation",
    icon: BrainCircuit,
  },
  {
    type: "HTTP_AGENT",
    name: "HTTP Agent",
    description: "Call external APIs and services",
    icon: Globe,
  },
  {
    type: "TRANSFORM_AGENT",
    name: "Transform Agent",
    description: "Transform and reshape workflow data",
    icon: Shuffle,
  },
];

const NodePalette = () => {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);

    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="fixed left-0 top-16 flex h-[calc(100vh-4rem)] w-65 flex-col border-r border-border bg-sidebar/80 p-4 backdrop-blur-xl">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Agent Nodes</h2>

        <p className="mt-1 text-sm text-muted-foreground">
          Drag agents onto the workflow canvas.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;

          return (
            <div
              key={agent.type}
              draggable
              onDragStart={(e) => onDragStart(e, agent.type)}
              className="group cursor-grab rounded-2xl border border-border bg-card/70 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:bg-card active:cursor-grabbing"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{agent.name}</h3>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {agent.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};

export default NodePalette;
