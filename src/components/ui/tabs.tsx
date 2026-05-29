import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

export function Tabs({ children }: TabsProps) {
  return <div>{children}</div>;
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center rounded-md border border-border bg-elevated p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
  currentValue: string;
  onValueChange: (value: string) => void;
};

export function TabsTrigger({
  className,
  value,
  currentValue,
  onValueChange,
  ...props
}: TabsTriggerProps) {
  return (
    <button
      type="button"
      data-state={currentValue === value ? "active" : "inactive"}
      className={cn(
        "h-6 rounded px-2.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-surface data-[state=active]:text-primary data-[state=active]:shadow-sm",
        className,
      )}
      onClick={() => onValueChange(value)}
      {...props}
    />
  );
}
