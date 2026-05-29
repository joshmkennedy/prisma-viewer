import { Braces, TableProperties } from "lucide-react";
import { CopyableCodeBlock } from "../../components/ui/copyable-code-block";
import type { Field } from "../../domain/prisma-metadata";
import { formatFieldType, formatValue } from "../../domain/row-formatting";
import { cn } from "../../lib/utils";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { formatRecordPreviewJson, type PreviewMode } from "./record-preview-model";

export function RecordPreview({
  record,
  fields,
  previewMode,
  onPreviewModeChange,
  emptyMessage,
}: {
  record: Record<string, unknown> | null;
  fields: Field[];
  previewMode: PreviewMode;
  onPreviewModeChange: (value: string) => void;
  emptyMessage: string;
}) {
  if (!record) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-xs text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      <Tabs value={previewMode} onValueChange={onPreviewModeChange}>
        <TabsList className="mb-3">
          <TabsTrigger
            value="fields"
            currentValue={previewMode}
            onValueChange={onPreviewModeChange}
            aria-label="Fields"
            title="Fields"
          >
            <TableProperties className="h-3 w-3" aria-hidden="true" />
          </TabsTrigger>
          <TabsTrigger
            value="json"
            currentValue={previewMode}
            onValueChange={onPreviewModeChange}
            aria-label="JSON"
            title="JSON"
          >
            <Braces className="h-3 w-3" aria-hidden="true" />
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {previewMode === "fields" ? (
        <dl className="max-h-full overflow-auto rounded-md border border-border bg-surface">
          {fields.map((field) => (
            <div
              key={field.name}
              className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-border last:border-b-0"
            >
              <dt className="border-r border-border bg-panel px-2 py-2">
                <span className="block truncate text-xs font-medium">{field.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {formatFieldType(field)}
                </span>
              </dt>
              <dd className="min-w-0 px-2 py-2 font-mono text-[11px] leading-5">
                <span
                  title={formatValue(record[field.name])}
                  className={cn(
                    "block break-words",
                    record[field.name] === null && "text-muted-foreground",
                  )}
                >
                  {formatValue(record[field.name])}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <CopyableCodeBlock
          ariaLabel="Selected record JSON preview"
          copyLabel="Copy selected record JSON"
          value={formatRecordPreviewJson(record)}
          preClassName="max-h-full max-w-full whitespace-pre-wrap break-words leading-5"
        />
      )}
    </>
  );
}
