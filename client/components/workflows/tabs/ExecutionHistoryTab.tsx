"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  XCircle,
  Square,
  RefreshCw,
} from "lucide-react";
import { useWorkflowRuns } from "@/hooks/use-run";
import { RUN_STATUS_STYLES } from "@/lib/constants/status.constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/date";

type ExecutionHistoryTabProps = {
  workflowId: string;
  onTriggerRun: () => void;
};

export default function ExecutionHistoryTab({
  workflowId,
  onTriggerRun,
}: ExecutionHistoryTabProps) {
  const { data: runsData, isLoading, refetch, isRefetching } = useWorkflowRuns(workflowId);

  const runs = (runsData?.data as any)?.data ?? runsData?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            Workflow Execution History
          </h3>
          <p className="text-xs text-muted-foreground">
            Audit logs and live status of all executions for this workflow.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="cursor-pointer rounded-xl border-border text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isRefetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={onTriggerRun}
            className="cursor-pointer rounded-xl bg-card-foreground text-xs font-semibold text-background hover:bg-white"
          >
            <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
            Trigger New Run
          </Button>
        </div>
      </div>

      {/* Runs List */}
      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground">
            <Activity className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">No Executions Recorded</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            This workflow has not been triggered yet. Click "Trigger New Run" to start the first execution.
          </p>
          <Button
            onClick={onTriggerRun}
            className="mt-4 cursor-pointer rounded-xl bg-card-foreground px-5 py-2 text-xs font-semibold text-background hover:bg-white"
          >
            <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
            Trigger First Run
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card/80">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5 font-medium">Status</th>
                  <th className="px-5 py-3.5 font-medium">Run ID</th>
                  <th className="px-5 py-3.5 font-medium">Started At</th>
                  <th className="px-5 py-3.5 font-medium">Duration</th>
                  <th className="px-5 py-3.5 font-medium">Tasks Progress</th>
                  <th className="px-5 py-3.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run: any) => {
                  const tasks = run.tasks ?? [];
                  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETED").length;
                  const totalTasks = tasks.length;
                  const duration =
                    run.completedAt && run.startedAt
                      ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
                      : run.status === "RUNNING"
                      ? "In progress..."
                      : "—";

                  return (
                    <tr key={run.id} className="transition-colors hover:bg-muted/20">
                      {/* Status */}
                      <td className="px-5 py-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                            RUN_STATUS_STYLES[run.status],
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              run.status === "COMPLETED"
                                ? "bg-emerald-400"
                                : run.status === "RUNNING"
                                ? "bg-blue-400 animate-pulse"
                                : run.status === "FAILED"
                                ? "bg-red-400"
                                : run.status === "CANCELLED"
                                ? "bg-zinc-400"
                                : "bg-yellow-400",
                            )}
                          />
                          {run.status}
                        </span>
                      </td>

                      {/* Run ID */}
                      <td className="px-5 py-4 font-mono text-[11px] text-muted-foreground">
                        {run.id ? `${run.id.slice(0, 10)}...` : "--"}
                      </td>

                      {/* Started At */}
                      <td className="px-5 py-4 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(run.startedAt)}
                      </td>

                      {/* Duration */}
                      <td className="px-5 py-4 text-foreground font-medium">
                        {duration}
                      </td>

                      {/* Tasks Progress */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{
                                width: totalTasks > 0 ? `${(completedTasks / totalTasks) * 100}%` : "0%",
                              }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {completedTasks}/{totalTasks}
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/runs/${run.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <span>Live Monitor</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
