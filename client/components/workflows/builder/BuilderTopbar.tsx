"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  ArrowLeft,
  Save,
  Undo2,
  Redo2,
  LayoutGrid,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

type BuilderTopbarProps = {
  workflowName: string;
  setWorkflowName: (value: string) => void;
  canSave: boolean;
  onSave: () => void;
  isSaving?: boolean;
  backHref?: string;
  saveButtonText?: string;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onAutoLayout?: () => void;
  onExportJson?: () => void;
  onImportJson?: (imported: { name?: string; description?: string; definition: any }) => void;
};

const BuilderTopbar = ({
  workflowName,
  setWorkflowName,
  canSave,
  onSave,
  isSaving,
  backHref = "/workflows",
  saveButtonText = "Save Workflow",
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onAutoLayout,
  onExportJson,
  onImportJson,
}: BuilderTopbarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed.definition || !Array.isArray(parsed.definition.nodes)) {
          toast.error("Invalid workflow JSON: Missing definition.nodes array");
          return;
        }
        if (onImportJson) {
          onImportJson(parsed);
          toast.success("Workflow imported successfully");
        }
      } catch (err: unknown) {
        toast.error("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      {/* Left */}
      <div className="flex items-center gap-4">
        <Link
          href={backHref}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card transition-all duration-200 hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <input
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          placeholder="Untitled Workflow"
          className="min-w-64 border-none bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground sm:min-w-72"
        />
      </div>

      {/* Middle Tools: Undo/Redo/AutoLayout/Import/Export */}
      <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card/60 p-1">
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        )}

        {onRedo && (
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        )}

        {(onUndo || onRedo) && <div className="mx-1 h-4 w-px bg-border" />}

        {onAutoLayout && (
          <button
            type="button"
            onClick={onAutoLayout}
            title="Auto Layout Graph (Dagre)"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Auto Layout</span>
          </button>
        )}

        {onExportJson && (
          <button
            type="button"
            onClick={onExportJson}
            title="Export workflow JSON definition"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        )}

        {onImportJson && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Import workflow from JSON"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={!canSave || isSaving}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card-foreground px-4 py-2 text-sm font-medium text-background transition-all duration-300 ease-out hover:scale-[1.03] hover:bg-white hover:shadow-lg hover:shadow-white/5 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : saveButtonText}
        </button>
      </div>
    </header>
  );
};

export default BuilderTopbar;
