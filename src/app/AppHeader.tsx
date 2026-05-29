import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "../lib/utils";

export type AppHeaderRoute = "models" | "query-lab";

export function AppHeader({
  activeRoute,
  actions,
}: {
  activeRoute: AppHeaderRoute;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur">
      <Link to="/" className="flex min-w-0 items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated shadow-sm">
          <Database className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Prisma Pad</h1>
          <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
            read-only local database viewer
          </p>
        </div>
      </Link>

      <div className="flex shrink-0 items-center justify-end gap-3">
        <nav className="flex items-center gap-3" aria-label="Primary navigation">
          <HeaderNavLink to="/" active={activeRoute === "models"}>
            Models
          </HeaderNavLink>
          <HeaderNavLink to="/query-lab" active={activeRoute === "query-lab"}>
            Query Lab
          </HeaderNavLink>
        </nav>
        {actions}
      </div>
    </header>
  );
}

function HeaderNavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-1 font-mono text-[11px] font-medium uppercase tracking-normal transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors",
          active ? "bg-primary" : "bg-transparent",
        )}
        aria-hidden="true"
      />
      {children}
    </Link>
  );
}
