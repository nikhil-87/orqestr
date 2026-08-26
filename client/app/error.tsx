"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log client error to console for diagnostics
    console.error("[Orqestr Error Boundary]:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive shadow-lg">
        <AlertTriangle className="h-8 w-8" />
      </div>

      <div className="mt-6 max-w-md space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          An unexpected error occurred in this view. You can retry the action or return to the dashboard.
        </p>
        {error?.message && (
          <div className="mt-3 rounded-xl border border-border bg-card/60 p-3 text-left">
            <p className="font-mono text-xs text-muted-foreground break-all">
              {error.message}
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button
          onClick={reset}
          variant="outline"
          className="cursor-pointer rounded-xl border-border text-xs font-medium"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Try Again
        </Button>

        <Button
          asChild
          className="cursor-pointer rounded-xl bg-card-foreground text-xs font-semibold text-background hover:bg-white"
        >
          <Link href="/dashboard">
            <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
            Return to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
