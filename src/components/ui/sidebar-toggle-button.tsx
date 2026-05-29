import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "../../lib/utils";

export function SidebarToggleButton({
  side,
  isCollapsed,
  collapsedLabel,
  expandedLabel,
  onClick,
  className,
}: {
  side: "left" | "right";
  isCollapsed: boolean;
  collapsedLabel: string;
  expandedLabel: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon =
    side === "left"
      ? isCollapsed
        ? PanelLeftOpen
        : PanelLeftClose
      : isCollapsed
        ? PanelRightOpen
        : PanelRightClose;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isCollapsed ? collapsedLabel : expandedLabel}
      title={isCollapsed ? collapsedLabel : expandedLabel}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted-foreground transition-colors hover:border-primary hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
