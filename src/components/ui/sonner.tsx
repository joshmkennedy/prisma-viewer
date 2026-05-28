import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-border bg-elevated text-foreground shadow-tool font-sans",
          title: "text-sm font-medium text-foreground",
          description: "text-xs text-muted-foreground",
          error: "border-danger/70",
        },
      }}
      {...props}
    />
  );
}
