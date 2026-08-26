// components/icon.tsx

import { Workflow } from "lucide-react";

type IconProps = {
  className?: string;
  size?: number;
  showDot?: boolean;
};

const Icon = ({ className, size = 44, showDot = true }: IconProps) => {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-linear-to-br from-zinc-900 to-black shadow-lg shadow-black/40 ${className}`}
      style={{
        width: size,
        height: size,
      }}
    >
      {/* glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_60%)]" />

      {/* inner border */}
      <div className="absolute inset-px rounded-[15px] border border-white/5" />

      {/* icon */}
      <Workflow
        className="relative z-10 text-white"
        size={size * 0.42}
        strokeWidth={2.2}
      />

      {/* status dot */}
      {showDot && (
        <div
          className="absolute rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.8)]"
          style={{
            width: size * 0.16,
            height: size * 0.16,
            bottom: size * 0.1,
            right: size * 0.1,
          }}
        />
      )}
    </div>
  );
};

export default Icon;
