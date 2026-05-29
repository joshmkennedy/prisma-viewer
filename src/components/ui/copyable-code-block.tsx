import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type CopyableCodeBlockProps = {
  ariaLabel: string;
  copyLabel: string;
  value: string;
  className?: string;
  preClassName?: string;
};

export function CopyableCodeBlock({
  ariaLabel,
  copyLabel,
  value,
  className,
  preClassName,
}: CopyableCodeBlockProps) {
  return (
    <div className={cn("relative", className)}>
      <pre
        aria-label={ariaLabel}
        className={cn(
          "max-h-72 overflow-auto rounded-md border border-border bg-surface p-3 pr-12 font-mono text-[11px] text-code",
          preClassName,
        )}
      >
        {value}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => copyCodeBlock(value, copyLabel)}
        aria-label={copyLabel}
        title={copyLabel}
        className="absolute right-2 top-2 h-7 w-7 bg-panel/95"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

async function copyCodeBlock(value: string, copyLabel: string) {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is unavailable.");
    }

    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard", {
      description: copyLabel.replace(/^Copy\s+/, ""),
    });
  } catch (error) {
    toast.error("Could not copy to clipboard", {
      description:
        error instanceof Error ? error.message : "The clipboard write failed.",
    });
  }
}
