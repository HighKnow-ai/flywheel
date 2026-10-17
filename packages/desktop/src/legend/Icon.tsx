import type { ComponentType } from "react";
import * as icons from "lucide-react";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

/** A lucide glyph by name, or nothing for an unknown name. Moved out of the deleted board row. */
export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}
