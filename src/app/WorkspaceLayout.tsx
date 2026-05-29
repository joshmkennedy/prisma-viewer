import { type CSSProperties, type ReactNode } from "react";
import { AppHeader, type AppHeaderRoute } from "./AppHeader";
import { SidebarToggleButton } from "../components/ui/sidebar-toggle-button";
import { cn } from "../lib/utils";

type WorkspaceSide = "left" | "right";

type WorkspaceLayoutProps = {
  activeRoute: AppHeaderRoute;
  children: ReactNode;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  leftSidebar: ReactNode;
  rightSidebar: ReactNode;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftCollapsedLabel: string;
  leftExpandedLabel: string;
  rightCollapsedLabel: string;
  rightExpandedLabel: string;
  leftWidth?: string;
  rightWidth?: string;
  centerMinWidth?: string;
};

export function WorkspaceLayout({
  activeRoute,
  children,
  isLeftCollapsed,
  isRightCollapsed,
  leftSidebar,
  rightSidebar,
  onToggleLeft,
  onToggleRight,
  leftCollapsedLabel,
  leftExpandedLabel,
  rightCollapsedLabel,
  rightExpandedLabel,
  leftWidth = "20rem",
  rightWidth = "22.5rem",
  centerMinWidth = "0px",
}: WorkspaceLayoutProps) {
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground shadow-tool">
      <AppHeader activeRoute={activeRoute} />

      <section
        className="workspace-layout relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
        data-left-collapsed={isLeftCollapsed}
        data-right-collapsed={isRightCollapsed}
        style={
          {
            "--workspace-left-width": leftWidth,
            "--workspace-right-width": rightWidth,
            "--workspace-center-min": centerMinWidth,
          } as CSSProperties
        }
      >
        {isLeftCollapsed ? (
          <SidebarToggleButton
            side="left"
            isCollapsed
            collapsedLabel={leftCollapsedLabel}
            expandedLabel={leftExpandedLabel}
            onClick={onToggleLeft}
            className="absolute left-3 top-1.5 z-20 shadow-sm"
          />
        ) : (
          leftSidebar
        )}

        {children}

        {isRightCollapsed ? (
          <SidebarToggleButton
            side="right"
            isCollapsed
            collapsedLabel={rightCollapsedLabel}
            expandedLabel={rightExpandedLabel}
            onClick={onToggleRight}
            className="absolute right-3 top-1.5 z-20 shadow-sm"
          />
        ) : (
          rightSidebar
        )}
      </section>
    </main>
  );
}

export function WorkspaceSidebar({
  side,
  children,
  className,
}: {
  side: WorkspaceSide;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-b border-border bg-panel lg:border-b-0",
        side === "left" ? "lg:border-r" : "lg:border-l",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function WorkspaceCenter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface", className)}
    >
      {children}
    </section>
  );
}

export function WorkspacePanelHeader({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/70 px-3",
        className,
      )}
    >
      {children ?? (
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          {title ? <h2 className="truncate text-sm font-semibold">{title}</h2> : null}
        </div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function WorkspaceContentHeader({
  children,
  isLeftCollapsed,
  isRightCollapsed,
  className,
}: {
  children: ReactNode;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center border-b border-border bg-panel/80 px-3",
        isLeftCollapsed && "pl-14",
        isRightCollapsed && "pr-14",
        className,
      )}
    >
      {children}
    </div>
  );
}
