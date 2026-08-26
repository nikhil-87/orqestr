"use client";

import { ArrowRight, Workflow, LogOut, LayoutDashboard, Plus } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";

const Navbar = () => {
  const { user, logout, loading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/3">
            <Workflow className="h-5 w-5 text-white" />
          </div>

          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Orqestr</h1>
            <p className="text-xs text-zinc-500">Distributed Workflow Platform</p>
          </div>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Features
          </a>

          <a
            href="#architecture"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Architecture
          </a>

          <Link
            href="/workflows/new"
            className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Workflow
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {!loading && user ? (
            <>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-white/15"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>

              <button
                onClick={() => logout()}
                title="Sign out"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition-all hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="text-sm font-medium text-zinc-300 transition-colors hover:text-white px-3 py-2"
              >
                Sign In
              </Link>

              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-medium text-black transition-all duration-300 hover:scale-[1.03] hover:bg-zinc-200"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
