// The popover behind the sliders button: every view preference in one place.
//
// One button rather than a row of them. Toggles that live as bare icons in
// the toolbar read as mystery switches (the old "row details" toggle looked
// like it flipped the model), so they are all filed here under a label.
//
// There is no "Sort by": within a section the order is always newest-created
// first — a stack that never reshuffles under the cursor — and the manual
// drag already covers the case where that is not what the user wants.
import { Icon } from "@/components/ui/icon";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { GroupBy } from "@/lib/sections";
import type { RowDetails } from "@/hooks/useViewState";

const DETAIL_LABELS: ReadonlyArray<[keyof RowDetails, string]> = [
  ["project", "Project"],
  ["branch", "Branch"],
  ["machine", "Machine"],
  ["model", "Model"],
  ["pullRequest", "Pull request"],
  ["agent", "Agent"],
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="w-[9.5rem] shrink-0">{children}</div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </span>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer select-none items-center gap-2 text-xs text-foreground"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className="size-3.5"
      />
      {label}
    </label>
  );
}

export function ViewOptions({
  open,
  onOpenChange,
  groupBy,
  onGroupByChange,
  compactRows,
  onCompactRowsChange,
  projectIcons,
  onProjectIconsChange,
  rowDetails,
  onRowDetailChange,
  showArchived,
  onShowArchivedChange,
  onCollapseAll,
  onExpandAll,
}: {
  open?: boolean;
  onOpenChange?(open: boolean): void;
  groupBy: GroupBy;
  onGroupByChange(next: GroupBy): void;
  compactRows: boolean;
  onCompactRowsChange(next: boolean): void;
  projectIcons: boolean;
  onProjectIconsChange(next: boolean): void;
  rowDetails: RowDetails;
  onRowDetailChange(detail: keyof RowDetails, on: boolean): void;
  showArchived: boolean;
  onShowArchivedChange(next: boolean): void;
  onCollapseAll(): void;
  onExpandAll(): void;
}) {
  const isLit = showArchived;
  const visibleDetails = DETAIL_LABELS.filter(
    ([detail]) =>
      !compactRows || detail === "machine" || detail === "project",
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="View options"
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
            isLit && "bg-accent/60 text-foreground",
          )}
        >
          <Icon name="SlidersHorizontal" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Row label="Group by">
              <Select
                value={groupBy}
                onValueChange={(next) => onGroupByChange(next as GroupBy)}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </Row>

          </div>

          <div className="flex flex-col gap-1.5">
            <Heading>Layout</Heading>
            <Check
              id="view-compact-rows"
              label="Compact rows"
              checked={compactRows}
              onChange={onCompactRowsChange}
            />
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              Keep branch, model, and other metadata in thread details.
            </p>
            <Check
              id="view-project-icons"
              label="Project icons"
              checked={projectIcons}
              onChange={onProjectIconsChange}
            />
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              Use each project's own icon or logo where it has one.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Heading>Show on rows</Heading>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {visibleDetails.map(([detail, label]) => (
                <Check
                  key={detail}
                  id={`view-detail-${detail}`}
                  label={label}
                  checked={rowDetails[detail]}
                  onChange={(next) => onRowDetailChange(detail, next)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Heading>Include</Heading>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Check
                id="view-show-archived"
                label="Archived"
                checked={showArchived}
                onChange={onShowArchivedChange}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 border-t border-border pt-2.5">
            <ActionButton icon="ChevronsUp" label="Collapse all" onClick={onCollapseAll} />
            <ActionButton icon="ChevronsDown" label="Expand all" onClick={onExpandAll} />
          </div>

        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
    >
      <Icon name={icon} className="size-3" />
      {label}
    </button>
  );
}
