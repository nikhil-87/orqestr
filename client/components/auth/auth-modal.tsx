"use client";

import { useState, type FormEvent } from "react";
import { Workflow } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { toast } from "sonner";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  description?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = "Sign in to save your workflow",
  description = "Create a free account or sign in to save and orchestrate workflows",
}: AuthModalProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { login, register } = useAuth();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Signed in successfully");
      onClose();
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(email, password, name);
      toast.success("Account created successfully");
      onClose();
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-950/95 p-6 text-white backdrop-blur-2xl sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <Workflow className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white">Orqestr</span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-white">{title}</DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">{description}</DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <SocialAuthButtons actionText={tab === "login" ? "Continue with" : "Sign up with"} />

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-zinc-500">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <Tabs value={tab} onValueChange={(val) => setTab(val as "login" | "register")}>
            <TabsList className="grid w-full grid-cols-2 bg-white/5 p-1">
              <TabsTrigger
                value="login"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Create Account
              </TabsTrigger>
            </TabsList>

            {/* Login Tab */}
            <TabsContent value="login" className="mt-4">
              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Email</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-white/30"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-white/30"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 w-full bg-white text-black hover:bg-zinc-200"
                >
                  {submitting ? "Signing in…" : "Sign In & Save"}
                </Button>
              </form>
            </TabsContent>

            {/* Register Tab */}
            <TabsContent value="register" className="mt-4">
              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Full Name</label>
                  <Input
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-white/30"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Email</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-white/30"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Password</label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-white/30"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 w-full bg-white text-black hover:bg-zinc-200"
                >
                  {submitting ? "Creating account…" : "Create Account & Save"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
