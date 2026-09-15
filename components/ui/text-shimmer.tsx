// prompt-kit's TextShimmer (https://www.prompt-kit.com/docs/text-shimmer),
// vendored. Two changes from upstream: the keyframe and animation come from
// text-shimmer.css instead of a tailwind config (the plugin build emits
// default-theme utilities only), and reduced-motion users get plain text.
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./text-shimmer.css";

export type TextShimmerProps = {
  as?: ElementType;
  /** Seconds per sweep. */
  duration?: number;
  /** Width of the bright band, 5–45 percent. */
  spread?: number;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>;

export function TextShimmer({
  as: Component = "span",
  className,
  duration = 4,
  spread = 20,
  children,
  style,
  ...props
}: TextShimmerProps) {
  const dynamicSpread = Math.min(Math.max(spread, 5), 45);
  return (
    <Component
      data-text-shimmer=""
      className={cn("bb-ws-text-shimmer", className)}
      style={{
        backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--foreground) 45%, transparent) ${50 - dynamicSpread}%, var(--foreground) 50%, color-mix(in srgb, var(--foreground) 45%, transparent) ${50 + dynamicSpread}%)`,
        ["--bb-ws-shimmer-duration" as string]: `${duration}s`,
        ...style,
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
