import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "./menu-item-hover.js";
import { LIST_HOVER_TRANSITION } from "./motion.js";
import { Icon } from "../../components/ui/icon.js";

type ContextMenuSubTriggerElement = React.ComponentRef<
  typeof ContextMenuPrimitive.SubTrigger
>;
type ContextMenuSubTriggerProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.SubTrigger
>;

type ContextMenuSubContentElement = React.ComponentRef<
  typeof ContextMenuPrimitive.SubContent
>;
type ContextMenuSubContentProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.SubContent
>;

type ContextMenuContentElement = React.ComponentRef<
  typeof ContextMenuPrimitive.Content
>;
type ContextMenuContentProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Content
>;

type ContextMenuItemElement = React.ComponentRef<
  typeof ContextMenuPrimitive.Item
>;
type ContextMenuItemProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Item
> & {
  variant?: "default" | "destructive";
};

type ContextMenuLabelElement = React.ComponentRef<
  typeof ContextMenuPrimitive.Label
>;
type ContextMenuLabelProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Label
>;

type ContextMenuSeparatorElement = React.ComponentRef<
  typeof ContextMenuPrimitive.Separator
>;
type ContextMenuSeparatorProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Separator
>;

type ContextMenuShortcutProps = React.HTMLAttributes<HTMLSpanElement>;

const CONTEXT_MENU_LAYER_CLASS = "z-[70]";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;
const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = React.forwardRef<
  ContextMenuSubTriggerElement,
  ContextMenuSubTriggerProps
>(
  (
    {
      className,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...props
    },
    ref,
  ) => {
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    return (
      <ContextMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
          "flex cursor-default select-none items-center gap-2 min-h-7 rounded-md px-2 py-1 text-xs max-md:pointer-coarse:min-h-11 max-md:pointer-coarse:text-sm outline-none focus:bg-state-hover focus:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          className,
        )}
        {...props}
        {...hoverProps}
      >
        {children}
        <Icon name="ChevronRight" className="ml-auto" />
      </ContextMenuPrimitive.SubTrigger>
    );
  },
);
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  ContextMenuSubContentElement,
  ContextMenuSubContentProps
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    ref={ref}
    {...usePortalScopeProps()}
    className={cn(
      CONTEXT_MENU_LAYER_CLASS,
      "min-w-28 max-h-[var(--radix-context-menu-content-available-height)] overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuContent = React.forwardRef<
  ContextMenuContentElement,
  ContextMenuContentProps
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      {...usePortalScopeProps()}
      className={cn(
        CONTEXT_MENU_LAYER_CLASS,
        "min-w-28 max-h-[var(--radix-context-menu-content-available-height)] overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    >
      <MenuHoverProvider>{children}</MenuHoverProvider>
    </ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  ContextMenuItemElement,
  ContextMenuItemProps
>(
  (
    {
      className,
      variant = "default",
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...props
    },
    ref,
  ) => {
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        data-variant={variant}
        className={cn(
          "relative flex cursor-default select-none items-center gap-2 min-h-7 rounded-md px-2 py-1 text-xs max-md:pointer-coarse:min-h-11 max-md:pointer-coarse:text-sm outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-3.5 [&>svg]:shrink-0",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          variant === "destructive" && "text-destructive focus:bg-destructive/10 focus:text-destructive data-[last-hovered]:bg-destructive/10 data-[last-hovered]:text-destructive",
          className,
        )}
        {...props}
        {...hoverProps}
      />
    );
  },
);
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuLabel = React.forwardRef<
  ContextMenuLabelElement,
  ContextMenuLabelProps
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  ContextMenuSeparatorElement,
  ContextMenuSeparatorProps
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

function ContextMenuShortcut({
  className,
  ...props
}: ContextMenuShortcutProps) {
  return (
    <span
      className={cn("ml-auto shrink-0 pl-3 text-[10px] tabular-nums tracking-wide text-muted-foreground max-md:pointer-coarse:text-xs", className)}
      {...props}
    />
  );
}
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
};
