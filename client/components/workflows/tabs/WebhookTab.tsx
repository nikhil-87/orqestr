"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Code2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflowWebhook,
  useCreateWebhook,
  useToggleWebhook,
  useRegenerateWebhookToken,
  useDeleteWebhook,
  type WorkflowWebhook,
} from "@/hooks/use-webhook";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type WebhookTabProps = {
  workflowId: string;
};

export default function WebhookTab({ workflowId }: WebhookTabProps) {
  const { data: webhookData, isLoading, refetch } = useWorkflowWebhook(workflowId);
  const { mutateAsync: createWebhook, isPending: isCreating } = useCreateWebhook();
  const { mutateAsync: toggleWebhook, isPending: isToggling } = useToggleWebhook();
  const { mutateAsync: regenerateToken, isPending: isRegenerating } = useRegenerateWebhookToken();
  const { mutateAsync: deleteWebhook, isPending: isDeleting } = useDeleteWebhook();

  const webhook: WorkflowWebhook | null =
    (webhookData?.data as any)?.data ?? (webhookData?.data as any) ?? null;

  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [snippetLanguage, setSnippetLanguage] = useState<"curl" | "js" | "python">("curl");
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const baseUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : "http://localhost:8000");

  const triggerUrl = webhook && webhook.token ? `${baseUrl}/api/webhooks/trigger/${webhook.token}` : "";
  const maskedUrl = webhook && webhook.token
    ? `${baseUrl}/api/webhooks/trigger/${webhook.token.slice(0, 6)}••••••••••••••••`
    : "";

  const handleCopyUrl = () => {
    if (!triggerUrl) return;
    navigator.clipboard.writeText(triggerUrl);
    setCopied(true);
    toast.success("Webhook trigger URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async () => {
    try {
      await createWebhook(workflowId);
      toast.success("Inbound webhook trigger enabled");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create webhook";
      toast.error(msg);
    }
  };

  const handleToggle = async () => {
    if (!webhook) return;
    try {
      await toggleWebhook({
        workflowId,
        enabled: !webhook.enabled,
      });
      toast.success(`Webhook ${!webhook.enabled ? "enabled" : "disabled"} successfully`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle webhook";
      toast.error(msg);
    }
  };

  const handleRegenerate = async () => {
    try {
      await regenerateToken(workflowId);
      toast.success("Webhook token regenerated. Old URL is now invalid.");
      setRegenerateDialogOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to regenerate token";
      toast.error(msg);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWebhook(workflowId);
      toast.success("Webhook trigger removed");
      setDeleteDialogOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete webhook";
      toast.error(msg);
    }
  };

  const snippets = {
    curl: `curl -X POST "${triggerUrl || "https://api.orqestr.com/api/webhooks/trigger/YOUR_TOKEN"}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello from external system", "userId": "123"}'`,
    js: `await fetch("${triggerUrl || "https://api.orqestr.com/api/webhooks/trigger/YOUR_TOKEN"}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Hello from external system",
    userId: "123"
  })
});`,
    python: `import requests

response = requests.post(
    "${triggerUrl || "https://api.orqestr.com/api/webhooks/trigger/YOUR_TOKEN"}",
    json={"message": "Hello from external system", "userId": "123"}
)
print(response.json())`,
  };

  const handleCopySnippet = (lang: "curl" | "js" | "python") => {
    navigator.clipboard.writeText(snippets[lang]);
    setCopiedSnippet(lang);
    toast.success(`Copied ${lang.toUpperCase()} snippet`);
    setTimeout(() => setCopiedSnippet(null), 2000);
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
      {/* Status Banner */}
      {webhook ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <h3 className="font-semibold text-foreground">Inbound Webhook Active</h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                  webhook.enabled
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                }`}
              >
                {webhook.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              External services can trigger this workflow by sending HTTP POST requests.
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
              {webhook.enabled ? "Disable Webhook" : "Enable Webhook"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRegenerateDialogOpen(true)}
              className="cursor-pointer rounded-xl border-border text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Regenerate
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
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground">
            <Globe className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">No Webhook Configured</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Generate an HTTP endpoint to trigger this workflow from GitHub, Stripe, Zapier, or any custom service.
          </p>
          <Button
            onClick={handleCreate}
            disabled={isCreating}
            className="mt-5 cursor-pointer rounded-xl bg-card-foreground px-5 py-2 text-xs font-semibold text-background hover:bg-white"
          >
            {isCreating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Enable Inbound Webhook
          </Button>
        </div>
      )}

      {/* Webhook Details & Trigger URL */}
      {webhook && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card/80 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold tracking-tight text-foreground">
                Webhook Trigger URL
              </h4>
              <span className="text-[11px] text-muted-foreground">Rate limit: 100 req / min</span>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/80 p-2">
              <input
                type="text"
                readOnly
                value={revealed ? triggerUrl : maskedUrl}
                className="w-full bg-transparent px-2 font-mono text-xs text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => setRevealed(!revealed)}
                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title={revealed ? "Hide token" : "Reveal token"}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <Button
                size="sm"
                onClick={handleCopyUrl}
                className="cursor-pointer rounded-lg bg-card-foreground px-3 py-1.5 text-xs text-background hover:bg-white"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
              </Button>
            </div>
          </div>

          {/* Interactive Code Snippets */}
          <div className="rounded-2xl border border-border bg-card/80 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold tracking-tight text-foreground">
                  Example Integration
                </h4>
              </div>

              {/* Language Tabs */}
              <div className="flex gap-1 rounded-xl border border-border bg-background/60 p-1">
                {(["curl", "js", "python"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSnippetLanguage(lang)}
                    className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-medium uppercase transition-all ${
                      snippetLanguage === lang
                        ? "bg-card-foreground text-background shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lang === "js" ? "JavaScript" : lang}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-border bg-background">
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
                {snippets[snippetLanguage]}
              </pre>
              <button
                type="button"
                onClick={() => handleCopySnippet(snippetLanguage)}
                className="absolute right-3 top-3 cursor-pointer rounded-lg border border-border bg-card/80 p-1.5 text-muted-foreground shadow-xs transition-colors hover:bg-card hover:text-foreground"
                title="Copy snippet"
              >
                {copiedSnippet === snippetLanguage ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Token Dialog */}
      <Dialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl border-border bg-card p-6">
          <DialogHeader>
            <DialogTitle>Regenerate Webhook Token</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Generating a new token will <strong>immediately invalidate</strong> the previous trigger URL. Any third-party webhooks configured with the old token will fail until updated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRegenerateDialogOpen(false)}
              className="rounded-xl border-border text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isRegenerating}
              onClick={handleRegenerate}
              className="rounded-xl bg-primary text-xs text-primary-foreground hover:bg-primary/90"
            >
              {isRegenerating ? "Regenerating..." : "Regenerate Token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Webhook Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl border-border bg-card p-6">
          <DialogHeader>
            <DialogTitle>Remove Inbound Webhook</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete this webhook? External HTTP requests to this URL will be rejected.
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
              {isDeleting ? "Deleting..." : "Delete Webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
