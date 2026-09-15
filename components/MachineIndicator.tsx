import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  ComputerTerminal01Icon,
  InformationCircleIcon,
  LaptopIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Recognize explicit device names; arbitrary host names keep a generic glyph. */
export function machineKind(name: string): "laptop" | "desktop" | "computer" {
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

/** A small device icon beside project context, with keyboard/touch access to details. */
export function MachineIndicator({
  name,
  threadTitle,
  open,
  onOpenChange,
  onWarm,
  children,
}: {
  name: string | null;
  threadTitle: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onWarm(): void;
  children: ReactNode;
}) {
  return (
    <span
      className="flex shrink-0"
      // Portal events follow the React tree, including the mobile sheet's
      // backdrop and handle. None of them should activate or drag the row.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => event.stopPropagation()}
    >
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={name === null ? `Details for ${threadTitle}` : `Machine: ${name}. Details for ${threadTitle}`}
          title={name === null ? "Thread details" : `Machine: ${name}`}
          onPointerEnter={onWarm}
          onFocus={onWarm}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          // Do not preventDefault: the popover trigger still needs to toggle.
          onClick={(event) => event.stopPropagation()}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:size-11"
        >
          {name === null ? <HugeiconsIcon icon={InformationCircleIcon} aria-hidden className="size-3" /> : <MachineIcon name={name} className="size-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-auto max-w-[calc(100vw-1.5rem)] p-3"
        mobileTitle="Thread details"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
    </span>
  );
}
