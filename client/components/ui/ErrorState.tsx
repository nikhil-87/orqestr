import { AlertTriangle, RefreshCw } from "lucide-react";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

const ErrorState = ({
  title = "Failed to load data",
  description = "Something went wrong while fetching data from the server.",
  onRetry,
}: ErrorStateProps) => {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-destructive/20 bg-destructive/3 px-6 text-center">
      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>

      {/* Content */}
      <div className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>

        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {/* Retry */}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 cursor-pointer inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition-all duration-300 ease-out hover:scale-[1.03] hover:bg-accent hover:shadow-lg hover:shadow-black/20 active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
};

export default ErrorState;
