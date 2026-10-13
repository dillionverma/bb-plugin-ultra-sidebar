// prompt-kit's TextShimmer (https://www.prompt-kit.com/docs/text-shimmer),
// vendored. Changes from upstream: the keyframe and animation come from
// text-shimmer.css instead of a tailwind config (the plugin build emits
// default-theme utilities only), reduced-motion users get plain text, and
// the `as` and `spread` props are gone, so it is always a span with a 20
// percent band.
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./text-shimmer.css";

export type TextShimmerProps = {
  /** Seconds per sweep. */
  duration?: number;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>;

export function TextShimmer({
  className,
  duration = 4,
  children,
  style,
  ...props
}: TextShimmerProps) {
  return (
    <span
      data-text-shimmer=""
      className={cn("bb-ws-text-shimmer", className)}
      style={{
        backgroundImage:
          "linear-gradient(to right, color-mix(in srgb, var(--foreground) 45%, transparent) 30%, var(--foreground) 50%, color-mix(in srgb, var(--foreground) 45%, transparent) 70%)",
        ["--bb-ws-shimmer-duration" as string]: `${duration}s`,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
