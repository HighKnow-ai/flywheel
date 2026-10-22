import { useLayoutEffect } from "react";

/**
 * Keeps `.dark` on <html> in step with the system appearance (direction.md § Tokens: "`.dark` is set from
 * `prefers-color-scheme`"). styles/globals.css holds the dark tokens under `.dark`, the class shadcn/ui's
 * `dark:` variant reads. There is no in-app theme setting yet; when one lands it decides here.
 */
export function applyColorScheme(root: HTMLElement = document.documentElement): () => void {
  const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => root.classList.toggle("dark", query?.matches ?? false);
  apply();
  query?.addEventListener("change", apply);
  return () => query?.removeEventListener("change", apply);
}

/** Applies the colour scheme before the first paint and follows the system while mounted. */
export function useColorScheme(): void {
  useLayoutEffect(() => applyColorScheme(), []);
}
