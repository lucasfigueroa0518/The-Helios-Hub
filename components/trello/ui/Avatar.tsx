"use client";

import { cn, initials } from "@/lib/trello/utils";

type Props = {
  name: string;
  hue?: number;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  active?: boolean;
  dim?: boolean;
  /** When avatars overlap in a stack, add a matching-background ring
   *  so the pills read as separate rather than merged. Rendered on
   *  the Avatar itself (one element) so the ring can't drift out of
   *  alignment with the colored fill. */
  stacked?: boolean;
};

const sizes = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
};

export function Avatar({
  name,
  hue = 22,
  size = "sm",
  className,
  active,
  dim,
  stacked,
}: Props) {
  const bg = `hsl(${hue} 55% 45%)`;
  return (
    <span
      className={cn(
        // leading-none guarantees the initials sit visually centered
        // instead of drifting because a parent inherited line-height
        // pushes them off the flex cross-axis. Roboto's ascent/descent
        // asymmetry makes this show up worst on smaller avatars.
        "inline-flex items-center justify-center rounded-full font-body font-semibold leading-none text-white",
        active && "ring-2 ring-helios-500 ring-offset-2 ring-offset-surface-base",
        // Stack ring lives ON the avatar (not on a wrapper) so it
        // cannot drift out of alignment. Dark-adapts to the card
        // surface it lives on so it doesn't glow as a bright halo
        // in dark mode.
        stacked && "ring-2 ring-white dark:ring-[#232a38]",
        dim && "opacity-35 saturate-50",
        sizes[size],
        className
      )}
      style={{ background: bg }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  names,
  hues,
  size = "sm",
  max = 3,
}: {
  names: string[];
  hues: number[];
  size?: "xs" | "sm" | "md" | "lg";
  max?: number;
}) {
  const visible = names.slice(0, max);
  const overflow = names.length - visible.length;
  return (
    <div className="flex -space-x-1">
      {visible.map((n, i) => (
        <Avatar
          key={n + i}
          name={n}
          hue={hues[i] ?? 22}
          size={size}
          stacked
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-neutral-100 font-body font-medium leading-none text-ink-mid ring-2 ring-white dark:ring-[#232a38]",
            size === "xs" && "h-5 w-5 text-[9px]",
            size === "sm" && "h-6 w-6 text-[10px]",
            size === "md" && "h-7 w-7 text-[11px]",
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
