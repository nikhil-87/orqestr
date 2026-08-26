"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Orqestr Global Error]:", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="flex max-w-md flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 shadow-xl">
            <AlertTriangle className="h-8 w-8" />
          </div>

          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-100">
            Critical Application Error
          </h2>

          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            A fatal error prevented the application from loading properly. Please click below to refresh the session.
          </p>

          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/dashboard";
              } else {
                reset();
              }
            }}
            className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 transition-all hover:bg-white active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Orqestr
          </button>
        </div>
      </body>
    </html>
  );
}
