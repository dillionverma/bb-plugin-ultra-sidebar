import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  ComputerTerminal01Icon,
  LaptopIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Recognize explicit device names; arbitrary host names keep a generic glyph. */
function machineKind(name: string): "laptop" | "desktop" | "computer" {
  const normalized = name.toLowerCase().replace(/[\s_]+/g, "-");
  if (/(^|-)(mbp|mba|macbook(?:-pro|-air)?|laptop)(-|$)/.test(normalized)) {
    return "laptop";
  }
  if (/(^|-)(mac-?mini|imac|desktop)(-|$)/.test(normalized)) return "desktop";
  return "computer";
}

export function MachineIcon({ name, className }: { name: string; className?: string }) {
  const kind = machineKind(name);
  return (
    <HugeiconsIcon
      icon={kind === "laptop" ? LaptopIcon : kind === "desktop" ? ComputerIcon : ComputerTerminal01Icon}
      aria-hidden
      data-machine-kind={kind}
      className={cn("size-3.5 shrink-0", className)}
    />
  );
}

export function MachineIndicator({ name }: { name: string | null }) {
  if (name === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Machine: ${name}`}
          data-machine-indicator=""
          data-no-drag=""
          onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => { event.preventDefault(); event.stopPropagation(); }}
          onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
          className="flex size-5 shrink-0 cursor-default items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        >
          <MachineIcon name={name} className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>Machine · {name}</TooltipContent>
    </Tooltip>
  );
}
