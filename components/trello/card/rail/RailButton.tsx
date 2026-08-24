"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cn } from "@/lib/trello/utils";

type RailButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode;
  active?: boolean;
  asChild?: boolean;
};

export const RailButton = React.forwardRef<HTMLButtonElement, RailButtonProps>(
  function RailButton(
    { icon, active, asChild, className, children, type, ...rest },
    ref,
  ) {
    const Comp: React.ElementType = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        data-active={active ? "" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-[6px] min-h-[38px] px-3 py-2 text-[13px] sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-[12.5px]",
          "text-left leading-none",
          "transition-colors duration-150 ease-expo",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
          active
            ? "bg-helios-500/10 text-helios-500 hover:bg-helios-500/15"
            : "bg-neutral-50 text-ink-mid hover:bg-neutral-100 hover:text-ink-hi",
          "data-[state=open]:bg-neutral-100 data-[state=open]:text-ink-hi",
          className,
        )}
        {...rest}
      >
        <span aria-hidden className="grid h-3.5 w-3.5 place-items-center shrink-0">
          {icon}
        </span>
        <Slottable>{children}</Slottable>
      </Comp>
    );
  },
);
