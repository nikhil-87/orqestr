"use client";

import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  useWorkflowSchedule,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useToggleSchedule,
  type WorkflowSchedule,
} from "@/hooks/use-scheduler";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const CRON_PRESETS = [
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Every hour (at minute 0)", cron: "0 * * * *" },
  { label: "Every day at 9:00 AM", cron: "0 9 * * *" },
  { label: "Every day at midnight", cron: "0 0 * * *" },
  { label: "Every weekday at 9:00 AM (Mon-Fri)", cron: "0 9 * * 1-5" },
  { label: "Every Sunday at midnight", cron: "0 0 * * 0" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

type ScheduleTabProps = {
  workflowId: string;
};

export default function ScheduleTab({ workflowId }: ScheduleTabProps) {
  const { data: scheduleData, isLoading, refetch } = useWorkflowSchedule(workflowId);
  const { mutateAsync: createSchedule, isPending: isCreating } = useCreateSchedule();
  const { mutateAsync: updateSchedule, isPending: isUpdating } = useUpdateSchedule();
  const { mutateAsync: deleteSchedule, isPending: isDeleting } = useDeleteSchedule();
  const { mutateAsync: toggleSchedule, isPending: isToggling } = useToggleSchedule();

  const schedule: WorkflowSchedule | null =
    (scheduleData?.data as any)?.data ?? (scheduleData?.data as any) ?? null;

  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState(CRON_PRESETS[2].cron);
  const [customCron, setCustomCron] = useState("0 * * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [inputJson, setInputJson] = useState("{\n  \n}");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Initialize timezone and state on mount / schedule load
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Ignore timezone detection error
    }
  }, []);

  useEffect(() => {
    if (schedule) {
      setCustomCron(schedule.cronExpression);
      const matchingPreset = CRON_PRESETS.find((p) => p.cron === schedule.cronExpression);
      if (matchingPreset) {
        setMode("preset");
        setSelectedPreset(schedule.cronExpression);
      } else {
        setMode("custom");
      }
      if (schedule.timezone) setTimezone(schedule.timezone);
      if (schedule.input) {
        setInputJson(JSON.stringify(schedule.input, null, 2));
      }
    }
  }, [schedule]);

  const activeCron = mode === "preset" ? selectedPreset : customCron;

  const handleSaveSchedule = async () => {
    try {
      let parsedInput = {};
      if (inputJson.trim()) {
        try {
          parsedInput = JSON.parse(inputJson);
        } catch {
          toast.error("Input payload must be valid JSON");
          return;
        }
      }

      if (!activeCron.trim()) {
        toast.error("Please provide a valid cron expression");
        return;
      }

      if (schedule) {
        await updateSchedule({
          workflowId,
          data: {
            cronExpression: activeCron.trim(),
            timezone,
            input: parsedInput,
          },
        });
        toast.success("Schedule updated successfully");
      } else {
        await createSchedule({
          workflowId,
          data: {
            cronExpression: activeCron.trim(),
            timezone,
            input: parsedInput,
            enabled: true,
          },
        });
        toast.success("Schedule created successfully");
      }
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save schedule";
      toast.error(msg);
    }
  };

  const handleToggle = async () => {
    if (!schedule) return;
    try {
      await toggleSchedule({
        workflowId,
        enabled: !schedule.enabled,
      });
      toast.success(
        `Schedule ${!schedule.enabled ? "enabled" : "disabled"} successfully`,
      );
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle schedule";
      toast.error(msg);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSchedule(workflowId);
      toast.success("Schedule removed");
      setDeleteDialogOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete schedule";
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
      {/* Top Banner / Current Status */}
      {schedule ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <h3 className="font-semibold text-foreground">Recurring Schedule Active</h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                  schedule.enabled
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                }`}
              >
                {schedule.enabled ? "Active" : "Paused"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Runs automatically using cron: <code className="font-mono text-foreground font-semibold">{schedule.cronExpression}</code> ({schedule.timezone})
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggle}
              disabled={isToggling}
              className="cursor-pointer rounded-xl border-border text-xs"
            >
              {schedule.enabled ? "Pause Schedule" : "Resume Schedule"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              className="cursor-pointer rounded-xl border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground">
            <Calendar className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">No Recurring Schedule</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Trigger this workflow automatically on an automated recurring timer or cron interval.
          </p>
        </div>
      )}

      {/* Schedule Configuration Card */}
      <div className="rounded-2xl border border-border bg-card/80 p-6 space-y-6">
        <h4 className="text-sm font-semibold tracking-tight text-foreground">
          {schedule ? "Update Schedule Settings" : "Configure New Schedule"}
        </h4>

        {/* Mode Selector */}
        <div className="flex gap-2 border-b border-border pb-4">
          <button
            type="button"
            onClick={() => setMode("preset")}
            className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-medium transition-all ${
              mode === "preset"
                ? "bg-card-foreground text-background shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            Friendly Presets
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-medium transition-all ${
              mode === "custom"
                ? "bg-card-foreground text-background shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            Custom Cron Expression
          </button>
        </div>

        {/* Preset Selector */}
        {mode === "preset" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.cron}
                type="button"
                onClick={() => setSelectedPreset(preset.cron)}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3.5 text-left transition-all ${
                  selectedPreset === preset.cron
                    ? "border-primary bg-primary/10 text-primary shadow-xs"
                    : "border-border bg-card/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
                }`}
              >
                <div>
                  <p className="text-xs font-medium text-foreground">{preset.label}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{preset.cron}</p>
                </div>
                {selectedPreset === preset.cron && (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Standard 5-Field Cron (Minute Hour Day-of-Month Month Day-of-Week)</label>
            <input
              type="text"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="e.g. 0 */2 * * *"
              className="w-full rounded-xl border border-border bg-card px-4 py-2.5 font-mono text-sm outline-none transition-colors focus:border-white/20"
            />
            <p className="text-[11px] text-muted-foreground">
              Example: <code className="text-primary font-mono">0 9 * * 1-5</code> runs Monday through Friday at 9:00 AM.
            </p>
          </div>
        )}

        {/* Timezone Selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Execution Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-foreground outline-none transition-colors focus:border-white/20 cursor-pointer"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz} className="bg-zinc-900 text-foreground py-1">
                {tz}
              </option>
            ))}
          </select>
        </div>

        {/* Input Payload Editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Scheduled Input Payload (JSON)</label>
            <span className="text-[11px] text-muted-foreground">Passed to the root node</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <MonacoEditor
              height="140px"
              language="json"
              theme="vs-dark"
              value={inputJson}
              onChange={(val) => setInputJson(val ?? "{}")}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "off",
                scrollBeyondLastLine: false,
                padding: { top: 8, bottom: 8 },
                renderLineHighlight: "none",
                overviewRulerLanes: 0,
              }}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSaveSchedule}
            disabled={isCreating || isUpdating}
            className="cursor-pointer rounded-xl bg-card-foreground px-5 py-2 text-xs font-semibold text-background hover:bg-white"
          >
            {isCreating || isUpdating ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {schedule ? "Update Schedule" : "Save & Activate Schedule"}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
          <DialogHeader>
            <DialogTitle>Delete Recurring Schedule</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete this schedule? This workflow will no longer trigger automatically.
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
              {isDeleting ? "Deleting..." : "Delete Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
