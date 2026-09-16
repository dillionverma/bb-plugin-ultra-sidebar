import { useMemo, useRef, useState, type ReactElement } from "react";
import { useRpc, useBbNavigate, experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnForwardIcon, InformationCircleIcon, Loading03Icon, Tick02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "./ui/command";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { createHandoffCatalog, type HandoffOptions } from "../lib/handoff-catalog";
import { rankHandoffModels, recordHandoffModel } from "../lib/handoff-preferences";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { cn } from "../lib/utils";
import { useSidebar } from "./sidebar-context";

function HandoffTip({ children, text }: { children: ReactElement; text: string }) {
  return <Tooltip delayDuration={350}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="right" sideOffset={8}>{text}</TooltipContent>
  </Tooltip>;
}

export function ThreadHandoff({ threadId, sourceProviderId, currentModel, onOpenChange }: {
  threadId: string;
  sourceProviderId: string;
  currentModel: string | null;
  onOpenChange(open: boolean): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const sidebar = useSidebar();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(sourceProviderId);
  const [options, setOptions] = useState<HandoffOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const request = useRef(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const catalog = useMemo(() => createHandoffCatalog(providerId => rpc.call("threads.handoffOptions", { threadId, providerId })), [rpc, threadId]);
  const warm = () => { void catalog.warm(sourceProviderId).catch(() => {}); };
  const sourceProvider = sidebar.provider(sourceProviderId);
  const selectedProvider = sidebar.provider(selectedId);
  const providerName = options?.providers.find(p => p.id === selectedId)?.name ?? selectedProvider?.displayName ?? sourceProviderId;
  const agentLabel = [sourceProvider?.displayName ?? sourceProviderId, currentModel].filter(Boolean).join(" · ");

  async function load(providerId = sourceProviderId, force = false) {
    const version = ++request.current;
    setSelectedId(providerId);
    setLoadError(null);
    const cached = force ? undefined : catalog.peek(providerId);
    if (cached) {
      setOptions(cached);
      setLoadError(cached.error);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await catalog.fetch(providerId, force);
      if (request.current === version) {
        setOptions(next);
        setLoadError(next.error);
      }
    } catch (cause) {
      if (request.current === version) setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === version) setLoading(false);
    }
  }

  function changeOpen(value: boolean) {
    setOpen(value);
    setTooltipOpen(false);
    onOpenChange(value);
    if (value) {
      setQuery("");
      setHandoffError(null);
      void load();
      warm();
    } else request.current++;
  }

  async function handoff(target?: { providerId: string; model: string }) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setHandoffError(null);
    try {
      const next = await rpc.call("threads.handoff", { threadId, ...(target ? { target } : {}) });
      if (target) recordHandoffModel(target.providerId, target.model);
      changeOpen(false);
      nav.toThread(next.threadId);
      toast.success("Handed off to a new thread");
    } catch (cause) {
      setHandoffError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <span className="inline-flex shrink-0"
      onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}>
      <Popover open={open} onOpenChange={changeOpen}>
        <Tooltip delayDuration={350} open={!open && tooltipOpen} onOpenChange={value => setTooltipOpen(!open && value)}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Hand off thread" data-state={open ? "open" : "closed"}
                className="bb-ws-row-action size-6 max-md:pointer-coarse:size-9" onPointerEnter={warm} onFocus={warm}
                onClick={event => { event.preventDefault(); event.stopPropagation(); changeOpen(!open); }}>
                <HugeiconsIcon icon={ArrowTurnForwardIcon} data-icon="inline-start" aria-hidden />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>Continue in a new thread with any model</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12}
          className="w-80 overflow-hidden p-0" mobileTitle="Hand off thread" autoFocusRef={inputRef}>
          <Command loop label="Search models" shouldFilter={false}>
            <CommandInput ref={inputRef} aria-label="Search models" placeholder="Search models…"
              value={query} onValueChange={setQuery} disabled={pending} />
            <Tabs value={selectedId} onValueChange={id => void load(id)}>
              <TabsList aria-label="Providers" variant="line" className="w-full justify-start overflow-x-auto px-2">
                {(options?.providers ?? [{ id: sourceProviderId, name: sourceProvider?.displayName ?? sourceProviderId, available: true }]).map(provider => (
                  <HandoffTip key={provider.id} text={provider.available ? provider.name : `${provider.name} is unavailable on this machine`}>
                    <span className="inline-flex"><TabsTrigger value={provider.id} disabled={!provider.available || pending} aria-label={provider.name} className="size-10 shrink-0 px-2">
                      <ProviderIcon providerKind="agent" provider={sidebar.provider(provider.id) ?? { id: provider.id }} className="size-5" />
                    </TabsTrigger></span>
                  </HandoffTip>
                ))}
              </TabsList>
              <TabsContent value={selectedId} className="mt-0" tabIndex={-1}>
            {handoffError && <div className="p-2"><Alert variant="destructive"><AlertTitle>Couldn’t create thread</AlertTitle><AlertDescription>{handoffError}</AlertDescription></Alert></div>}
            {loading ? (
              <div role="status" aria-label="Loading models" className="flex flex-col gap-3 p-3">
                {["w-4/5", "w-3/5", "w-2/3"].map(width => <div key={width} className="flex items-center gap-2"><Skeleton className="size-4" /><Skeleton className={cn("h-4", width)} /></div>)}
              </div>
            ) : loadError ? (
              <div className="p-2"><Alert variant="destructive"><AlertTitle>Models unavailable</AlertTitle><AlertDescription>
                <p>{loadError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load(selectedId, true)}>
                  <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden />Retry
                </Button>
              </AlertDescription></Alert></div>
            ) : (
              <CommandList className="max-h-64" aria-label="Models">
                <CommandEmpty>No matching models. Try another search.</CommandEmpty>
                <CommandGroup heading={providerName}>
                  {rankHandoffModels(selectedId, options?.models ?? []).filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())).map(model => (
                    <HandoffTip key={model.id} text={`Continue with ${model.name} · ${model.id}`}>
                      <CommandItem value={`${selectedId}/${model.id}`} disabled={pending}
                        onSelect={() => void handoff({ providerId: selectedId, model: model.id })} className="min-h-9">
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {selectedId === sourceProviderId && model.id === currentModel && <HugeiconsIcon icon={Tick02Icon} aria-label="Current model" />}
                      </CommandItem>
                    </HandoffTip>
                  ))}
                </CommandGroup>
              </CommandList>
            )}
              </TabsContent>
            </Tabs>
          </Command>
          <Separator />
          <div className="flex items-center justify-between gap-2 p-1.5">
            {pending ? <span role="status" className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><HugeiconsIcon icon={Loading03Icon} className="size-3.5 animate-spin" aria-hidden />Creating your new thread…</span> : (
              <HandoffTip text={`Continue with ${agentLabel}, using your Handoff settings.`}>
                <Button variant="ghost" size="sm" onClick={() => void handoff()} aria-label="Same agent">
                  <HugeiconsIcon icon={ArrowTurnForwardIcon} data-icon="inline-start" aria-hidden />Same agent
                </Button>
              </HandoffTip>
            )}
            <HandoffTip text="Choose a model to open a fresh thread on the same checkout. Your original thread stays available. Models you use most appear first.">
              <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="How handoff works">
                <HugeiconsIcon icon={InformationCircleIcon} aria-hidden />
              </Button>
            </HandoffTip>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
