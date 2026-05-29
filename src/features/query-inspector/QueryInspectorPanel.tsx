import { type ReactNode } from "react";
import { CopyableCodeBlock } from "../../components/ui/copyable-code-block";
import { cn } from "../../lib/utils";

type QueryInspectorPanelProps = {
  ariaLabel: string;
  heading: string;
  title: string;
  argsLabel: string;
  argsAriaLabel: string;
  argsJson: string;
  prismaCall: string;
  prismaCallAriaLabel?: string;
  notesLabel?: string;
  notesAriaLabel?: string;
  notes?: string[];
  emptyNotesMessage?: string;
  layout?: "split" | "stack";
  callFirst?: boolean;
  className?: string;
  children?: ReactNode;
};

export function QueryInspectorPanel({
  ariaLabel,
  heading,
  title,
  argsLabel,
  argsAriaLabel,
  argsJson,
  prismaCall,
  prismaCallAriaLabel = "Prisma Client call",
  notesLabel,
  notesAriaLabel,
  notes = [],
  emptyNotesMessage,
  layout = "split",
  callFirst = true,
  className,
  children,
}: QueryInspectorPanelProps) {
  const sectionClassName =
    "min-w-0 " + (callFirst ? "order-1" : "order-2");
  const argsClassName =
    "min-w-0 " + (callFirst ? "order-2" : "order-1");

  return (
    <section aria-label={ariaLabel} className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{heading}</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {title}
          </p>
        </div>
      </div>

      <div className={cn("grid gap-3", layout === "split" && "lg:grid-cols-2")}>
        <div className={sectionClassName}>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Prisma Client Call
          </div>
          <CopyableCodeBlock
            ariaLabel={prismaCallAriaLabel}
            copyLabel="Copy Prisma Client call"
            value={prismaCall}
          />
        </div>

        <div className={argsClassName}>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {argsLabel}
          </div>
          <CopyableCodeBlock
            ariaLabel={argsAriaLabel}
            copyLabel={`Copy ${argsLabel}`}
            value={argsJson}
          />
        </div>
      </div>

      {notes.length > 0 ? (
        <div className="mt-3">
          {notesLabel ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {notesLabel}
            </div>
          ) : null}
          <ul
            aria-label={notesAriaLabel}
            className="space-y-1 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground"
          >
            {notes.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : emptyNotesMessage ? (
        <div className="mt-3">
          {notesLabel ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {notesLabel}
            </div>
          ) : null}
          <p className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
            {emptyNotesMessage}
          </p>
        </div>
      ) : null}

      {children}
    </section>
  );
}
