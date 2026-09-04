import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Folder, Plus, X } from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

interface WorkspaceGroupSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function WorkspaceGroupSelect({
  id,
  value,
  onChange,
  placeholder = "Optional",
  disabled = false,
  className,
}: WorkspaceGroupSelectProps) {
  const { projects } = useDevHub();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects) {
      if (project.group?.trim()) {
        set.add(project.group.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const query = value.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!query) return existingGroups;
    return existingGroups.filter((g) => g.toLowerCase().includes(query));
  }, [existingGroups, query]);

  const hasExactMatch = existingGroups.some(
    (g) => g.toLowerCase() === value.trim().toLowerCase(),
  );

  const handleSelect = (groupName: string) => {
    onChange(groupName);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative flex items-center w-full", className)}>
          <Input
            id={id}
            ref={inputRef}
            type="text"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            className="pr-14"
            autoComplete="off"
            onChange={(event) => {
              onChange(event.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onClick={() => {
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                setOpen(true);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <div className="absolute right-1.5 flex items-center gap-0.5">
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                aria-label="Clear group"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  inputRef.current?.focus();
                }}
              >
                <X className="size-3" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              aria-label="Toggle group list"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((prev) => !prev);
                inputRef.current?.focus();
              }}
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  open && "rotate-180",
                )}
              />
            </Button>
          </div>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[calc(var(--radix-popover-anchor-width,100%))] min-w-[220px] max-h-60 overflow-y-auto p-1 text-xs"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {existingGroups.length === 0 ? (
          <div className="px-2.5 py-2 text-muted-foreground">
            {value.trim() ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer text-foreground"
                onClick={() => handleSelect(value.trim())}
              >
                <Plus className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">
                  Create group <strong>“{value.trim()}”</strong>
                </span>
              </button>
            ) : (
              <span>No groups yet. Type to create a new group.</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredGroups.length > 0 ? (
              filteredGroups.map((groupName) => {
                const isSelected = value.trim().toLowerCase() === groupName.toLowerCase();
                return (
                  <button
                    key={groupName}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left cursor-pointer transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground font-medium"
                        : "hover:bg-accent/60 text-foreground",
                    )}
                    onClick={() => handleSelect(groupName)}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Folder className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{groupName}</span>
                    </span>
                    {isSelected ? (
                      <Check className="size-3.5 shrink-0 text-foreground ml-1" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="px-2 py-1.5 text-muted-foreground">
                No matching groups found.
              </div>
            )}

            {value.trim() && !hasExactMatch ? (
              <>
                <div className="my-1 h-px bg-border -mx-1" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer text-foreground"
                  onClick={() => handleSelect(value.trim())}
                >
                  <Plus className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    Create new group <strong>“{value.trim()}”</strong>
                  </span>
                </button>
              </>
            ) : null}

            {value.trim() ? (
              <>
                <div className="my-1 h-px bg-border -mx-1" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors"
                  onClick={() => handleSelect("")}
                >
                  <X className="size-3.5 shrink-0" />
                  <span>Clear group (ungrouped)</span>
                </button>
              </>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
