"use client";

import { useState } from "react";
import { Loader2, Plus, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCreateOrganization } from "@/hooks/use-organization";
import { useCurrentOrg } from "@/providers/organization-provider";

type CreateOrgModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function CreateOrgModal({ open, onOpenChange }: CreateOrgModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const { mutateAsync: createOrg, isPending } = useCreateOrganization();
  const { switchOrganization } = useCurrentOrg();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }

    try {
      const res = await createOrg({
        name: name.trim(),
        slug: slug.trim() ? slug.trim() : undefined,
      });

      const newOrg = (res?.data as any)?.data ?? res?.data;
      toast.success(`Organization "${newOrg.name}" created successfully`);
      setName("");
      setSlug("");
      onOpenChange(false);

      if (newOrg?.id) {
        switchOrganization(newOrg.id, newOrg.name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create organization";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary/50">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Create Workspace
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Workspaces allow teams to collaborate on workflows and share execution runs.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Workspace Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Engineering"
              className="w-full rounded-xl border border-border bg-secondary/30 px-3.5 py-2 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Workspace Slug <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. acme-engineering"
              className="w-full rounded-xl border border-border bg-secondary/30 px-3.5 py-2 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground">
              Unique identifier for your workspace. If left blank, one will be generated from the name.
            </p>
          </div>

          <DialogFooter className="mt-6 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border-border text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !name.trim()}
              className="cursor-pointer rounded-xl bg-card-foreground text-xs font-semibold text-background hover:bg-white disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Workspace
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
