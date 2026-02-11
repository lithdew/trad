import { useRef, useEffect } from "react";
import { Streamdown } from "streamdown";
import { Loader2 } from "lucide-react";

export function LiveReasoning({ text }: { text: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [text]);

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="size-5 rounded-md bg-violet-500/15 flex items-center justify-center">
          <Loader2 className="size-2.5 text-violet-400 animate-spin" />
        </div>
        <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-[0.08em]">Thinking…</span>
      </div>
      <div className="text-[12.5px] leading-[1.7] text-violet-300/60 max-h-32 overflow-y-auto border-l-2 border-violet-400/15 pl-3.5 ml-2.5">
        <Streamdown animated={{ animation: "blurIn", duration: 150, easing: "ease-out" }} isAnimating={true}>
          {text.slice(-800)}
        </Streamdown>
        <div ref={endRef} />
      </div>
    </div>
  );
}
