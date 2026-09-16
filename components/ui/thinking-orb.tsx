// thinking-orbs' canvas, drawn by one shared loop.
//
// The package's own <ThinkingOrb> runs a requestAnimationFrame loop per orb.
// The drawing here is the package's — its presets and draw functions — but
// one ticker serves every orb on the page, skips the ones scrolled out of
// view, and stops when the window is hidden or no orb is left.
import { useEffect, useRef, useState, type CSSProperties, type CanvasHTMLAttributes } from "react";
import { MODE_DRAWS, resolvePreset, type OrbSize, type OrbState, type OrbTheme } from "thinking-orbs";

interface LiveOrb {
  draw(time: number): void;
  /** Off-screen orbs stay registered but are not drawn. */
  visible: boolean;
}

const live = new Set<LiveOrb>();
let frame = 0;

function tick(now: number) {
  frame = 0;
  if (live.size === 0) return;
  const time = now / 1000;
  for (const orb of live) if (orb.visible) orb.draw(time);
  frame = requestAnimationFrame(tick);
}

function ensureTicking() {
  if (frame === 0 && live.size > 0 && document.visibilityState !== "hidden") {
    frame = requestAnimationFrame(tick);
  }
}

function stopTicking() {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopTicking();
    else ensureTicking();
  });
}

/** jsdom has no matchMedia; treat a missing one as "no preference". */
function mediaQuery(query: string): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia(query) : null;
}

/** bb's `dark` class on <html>, else the OS preference. */
function useDarkTheme(theme: OrbTheme): boolean {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    if (theme === "dark") return setDark(true);
    if (theme === "light") return setDark(false);
    const media = mediaQuery("(prefers-color-scheme: dark)");
    const read = () => {
      const root = document.documentElement;
      const pinned = root.getAttribute("data-theme");
      if (pinned === "dark" || root.classList.contains("dark")) return setDark(true);
      if (pinned === "light" || root.classList.contains("light")) return setDark(false);
      setDark(media?.matches ?? true);
    };
    read();
    media?.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => {
      media?.removeEventListener("change", read);
      observer.disconnect();
    };
  }, [theme]);
  return dark;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = mediaQuery("(prefers-reduced-motion: reduce)");
    if (media === null) return;
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export interface ThinkingOrbProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "style"> {
  state: OrbState;
  size?: OrbSize;
  theme?: OrbTheme;
  /** Multiplier on the preset's baked speed. */
  speed?: number;
  paused?: boolean;
  style?: CSSProperties;
}

export function ThinkingOrb({
  state,
  size = 20,
  theme = "auto",
  speed = 1,
  paused = false,
  style,
  ...rest
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dark = useDarkTheme(theme);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * scale);
    canvas.height = Math.round(size * scale);
    const context = canvas.getContext("2d");
    if (context === null) return;
    const preset = resolvePreset(state, size);
    const drawMode = MODE_DRAWS[preset.mode];
    const rate = preset.speed * speed;
    const draw = (time: number) => {
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, size, size);
      drawMode(context, size, time * rate, dark, preset.opts);
    };

    // One still frame, and no loop, when motion is off or the orb is paused.
    draw(reducedMotion ? 0.6 : performance.now() / 1000);
    if (reducedMotion || paused) return;

    const orb: LiveOrb = { draw, visible: true };
    live.add(orb);
    ensureTicking();
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            orb.visible = entry?.isIntersecting ?? true;
          });
    observer?.observe(canvas);
    return () => {
      observer?.disconnect();
      live.delete(orb);
      if (live.size === 0) stopTicking();
    };
  }, [state, size, dark, speed, paused, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      style={{ width: size, height: size, display: "block", ...style }}
      {...rest}
    />
  );
}
