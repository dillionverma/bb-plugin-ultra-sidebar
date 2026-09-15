// A project's own artwork where it has some, else the folder glyph.
//
// Images come from our HTTP route as bytes the server has already vetted;
// glyphs are BB icon names the server rendered to SVG, drawn as a mask so
// they take the row's text color like any other icon.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";

// Mounted by bb at /api/v1/plugins/<id>/http/<path>; the id is the package
// name without its bb-plugin- prefix.
export const PROJECT_ICON_URL = "/api/v1/plugins/workspace-sidebar/http/project-icon";

export function ProjectIcon({
  projectId,
  isPersonal = false,
  className,
}: {
  projectId: string;
  isPersonal?: boolean;
  /** Sizing and color; the image fills it, the fallback glyph inherits it. */
  className?: string;
}) {
  const sidebar = useSidebar();
  const artwork = isPersonal ? null : sidebar.artworkOf(projectId);
  // A route that answers 404 (the cache expired and the file is gone) must
  // not leave a broken-image box in the sidebar.
  const [failed, setFailed] = useState<string | null>(null);

  if (artwork?.kind === "image" && failed !== projectId) {
    return (
      <img
        alt=""
        aria-hidden="true"
        data-project-artwork="image"
        draggable={false}
        decoding="async"
        className={cn("shrink-0 rounded-[3px] object-contain", className)}
        src={`${PROJECT_ICON_URL}?projectId=${encodeURIComponent(projectId)}`}
        onError={() => setFailed(projectId)}
      />
    );
  }

  if (artwork?.kind === "glyph") {
    const mask = `url("data:image/svg+xml,${encodeURIComponent(artwork.svg)}")`;
    return (
      <span
        aria-hidden="true"
        data-project-artwork="glyph"
        className={cn("inline-block shrink-0 bg-current", className)}
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }

  return (
    <span data-project-artwork="folder" className={cn("inline-flex shrink-0", className)}>
      <Icon name={isPersonal ? "Folder02" : "Folder"} aria-hidden className="size-full" />
    </span>
  );
}
