import { useState } from "react";
import { Streamdown } from "streamdown";
import { Loader2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

export function CollapsedReasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <CollapsibleTrigger className="flex items-center gap-2 mb-1 cursor-pointer group">
        <div className="size-5 rounded-md bg-violet-500/15 flex items-center justify-center">
          <Loader2 className="size-2.5 text-violet-400" />
        </div>
        <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-[0.08em]">
          Thinking
        </span>
        <ChevronDown
          className={`size-2.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-[12.5px] leading-[1.7] text-violet-300/70 max-h-52 overflow-y-auto border-l-2 border-violet-400/20 pl-3.5 ml-2.5 mt-1">
          <Streamdown
            animated={{ animation: "blurIn", duration: 100 }}
            isAnimating={false}
            mode="static"
          >
            {text.length > 3000 ? text.slice(0, 3000) + "…" : text}
          </Streamdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
