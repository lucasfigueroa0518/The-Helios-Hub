"use client";

import { Copy } from "lucide-react";
import { RailButton } from "@/components/trello/card/rail/RailButton";

export function CopyAction({ onCopy }: { onCopy: () => void }) {
  return (
    <RailButton
      icon={<Copy className="h-3.5 w-3.5" strokeWidth={2} />}
      onClick={onCopy}
    >
      Copy
    </RailButton>
  );
}
