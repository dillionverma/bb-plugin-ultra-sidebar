import { useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { UNASSIGNED_ID, type Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";

const triggerClass = "flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SidebarFilters({
  workspaces,
  workspaceId,
  onWorkspaceChange,
  projects,
  projectIds,
  onProjectsChange,
}: {
  workspaces: readonly Workspace[];
  workspaceId: string | null;
  onWorkspaceChange(workspaceId: string | null): void;
  projects: readonly PluginSidebarProject[];
  projectIds: readonly string[];
  onProjectsChange(projectIds: readonly string[]): void;
}) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const workspaceName = workspaceId === UNASSIGNED_ID
    ? "Unassigned"
    : workspaces.find(workspace => workspace.id === workspaceId)?.name ?? "All workspaces";
  const projectName = projectIds.length === 1
    ? projects.find(project => project.id === projectIds[0])?.name ?? "1 project"
    : projectIds.length > 1 ? `${projectIds.length} projects` : "All projects";
  const workspaceOptions = [
    { id: null, name: "All workspaces" },
    ...workspaces,
    { id: UNASSIGNED_ID, name: "Unassigned" },
  ];

  return <div className="flex min-w-0 flex-1 items-center gap-0.5" data-sidebar-filters="">
    <Popover open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Filter by workspace: ${workspaceName}`} title={workspaceName}
          className={cn(triggerClass, "max-w-36", workspaceId !== null && "bg-accent/60 text-foreground")}>
          <Icon name="Layers" className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{workspaceId === null ? "All" : workspaceName}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0" mobileTitle="Filter by workspace">
        <Command loop label="Workspaces">
          <CommandInput placeholder="Search workspaces…" />
          <CommandList>
            <CommandEmpty>No workspaces found.</CommandEmpty>
            <CommandGroup>
              {workspaceOptions.map(workspace => <CommandItem key={workspace.id ?? "all"}
                value={workspace.id ?? "all"} keywords={[workspace.name]}
                aria-checked={workspaceId === workspace.id}
                onSelect={() => { onWorkspaceChange(workspace.id); setWorkspaceOpen(false); }}>
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {workspaceId === workspace.id && <Icon name="Check" aria-hidden />}
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    <Popover open={projectsOpen} onOpenChange={setProjectsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Filter by project: ${projectName}`} title={projectName}
          className={cn(triggerClass, "max-w-36", projectIds.length > 0 && "bg-accent/60 text-foreground")}>
          <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{projectIds.length === 0 ? "Projects" : projectIds.length === 1 ? projectName : projectIds.length}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" mobileTitle="Filter by project">
        <Command loop label="Projects">
          <CommandInput placeholder="Search projects…" />
          <CommandList aria-multiselectable="true">
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all" keywords={["All projects"]} aria-checked={projectIds.length === 0}
                onSelect={() => onProjectsChange([])}>
                <Icon name="Folder" aria-hidden />
                <span className="flex-1">All projects</span>
                {projectIds.length === 0 && <Icon name="Check" aria-hidden />}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={workspaceId === null ? "Projects" : workspaceName}>
              {projects.map(project => {
                const checked = projectIds.includes(project.id);
                return <CommandItem key={project.id} value={project.id} keywords={[project.name]}
                  aria-checked={checked}
                  onSelect={() => onProjectsChange(checked ? projectIds.filter(id => id !== project.id) : [...projectIds, project.id])}>
                  <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded border border-border", checked && "border-primary bg-primary text-primary-foreground")}>
                    {checked && <Icon name="Check" className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </CommandItem>;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">{projectIds.length ? `${projectIds.length} selected` : "Showing all projects"}</span>
          <div className="flex items-center gap-2">
            {projectIds.length > 0 && <button type="button" className="rounded px-1 py-1 text-muted-foreground hover:text-foreground" onClick={() => onProjectsChange([])}>Clear</button>}
            <button type="button" aria-label="Done selecting projects" className="rounded-md bg-accent px-2 py-1 text-foreground hover:bg-accent/80" onClick={() => setProjectsOpen(false)}>Done</button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
