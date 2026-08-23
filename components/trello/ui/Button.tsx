"use client";

import { cn } from "@/lib/trello/utils";
import { forwardRef, ButtonHTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "ghost" | "quiet" | "outline";
type Size = "sm" | "md" | "lg";

/**
 * Button primitive with springy tactile feedback. Wraps motion.button so
 * primary CTAs pop, and hover subtly lifts them off the surface. All
 * variants share the same motion — the visual weight comes from the
 * palette variants below.
 */

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof HTMLMotionProps<"button">> &
  HTMLMotionProps<"button"> & {
    variant?: Variant;
    size?: Size;
  };

const variants: Record<Variant, string> = {
  // DS primary CTA — orange with the canonical glow. Pill radius everywhere.
  primary:
    "text-white bg-helios-500 hover:bg-helios-600 active:bg-helios-700 shadow-cta-glow",
  ghost:
    "text-ink-mid hover:text-ink-hi hover:bg-neutral-100",
  quiet:
    "text-ink-mid bg-neutral-100 hover:bg-neutral-200 hover:text-ink-hi",
  outline:
    "text-ink-hi border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300",
};

// DS: "border-radius: 9999px; always" for buttons and pills.
const sizes: Record<Size, string> = {
  sm: "h-8 px-4 text-[13px] rounded-full",
  md: "h-10 px-5 text-[13px] rounded-full",
  lg: "h-12 px-6 text-[14px] rounded-full",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "ghost", size = "md", ...rest },
  ref
) {
  return (
    <motion.button
      ref={ref}
      // Tactile press: scale down enough to feel, not enough to notice
      // as a bounce. Hover lifts 1px on primary/outline where the raise
      // reads; ghost/quiet stay put so tools don't feel jumpy.
      whileTap={{ scale: 0.965 }}
      whileHover={
        variant === "primary" || variant === "outline"
          ? { y: -1 }
          : undefined
      }
      transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.6 }}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-body font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    />
  );
});
