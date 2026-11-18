"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  applyTheme,
  resolveActiveTheme,
} from "@/lib/themes";

/** Restores the active theme and desktop window chrome after hydration. */
export function ThemeInitializer() {
  const { setTheme } = useTheme();

  useEffect(() => {
    const desktop =
      typeof window !== "undefined"
        ? (
            window as unknown as {
              CabinetDesktop?: {
                onFullscreenChanged?: (cb: (v: boolean) => void) => () => void;
              };
            }
          ).CabinetDesktop
        : undefined;
    let unsubscribeFullscreen: (() => void) | undefined;
    if (desktop) {
      document.documentElement.classList.add("electron-desktop");
      // Drop the traffic-light clearance while full-screen (globals.css).
      unsubscribeFullscreen = desktop.onFullscreenChanged?.((isFull) =>
        document.documentElement.classList.toggle("is-fullscreen", isFull)
      );
    }

    const themeDef = resolveActiveTheme();
    if (themeDef) {
      applyTheme(themeDef);
      setTheme(themeDef.type);
    }
    return () => unsubscribeFullscreen?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
