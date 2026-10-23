import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Search, Users, X } from 'lucide-react';
import { Dialog } from 'radix-ui';

import type { CollaborationSession } from '@shared/collaboration';
import type { AgentSession } from '@/shared/graph-state';
import { Button } from '@/components/ui/button';
import { SessionHoverCard } from '@/components/session-hover-card';
import { sessionDisplayLabel, statusDotClassNames } from '@/lib/session-display';
import { cn } from '@/lib/utils';

type ChatSearchDialogProps = {
  query: string;
  onQueryChange: (query: string) => void;
  sessions: AgentSession[];
  workspaces: CollaborationSession[];
  selectedSessionId?: string;
  selectedWorkspaceId?: string;
  onSelectSession: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
};

type SearchOption = {
  key: string;
  id: string;
  kind: 'chat' | 'workspace';
  label: string;
  cwd: string;
  archived: boolean;
  current: boolean;
  statusClass?: string;
  session?: AgentSession;
};

function projectLabel(cwd: string) {
  return (
    cwd
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .at(-1) || cwd
  );
}

export function ChatSearchDialog({
  query,
  onQueryChange,
  sessions,
  workspaces,
  selectedSessionId,
  selectedWorkspaceId,
  onSelectSession,
  onSelectWorkspace,
}: ChatSearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const chatsHeadingId = useId();
  const groupsHeadingId = useId();

  const options: SearchOption[] = [
    ...sessions.map((session) => ({
      key: `chat-${session.sessionId}`,
      id: session.sessionId,
      kind: 'chat' as const,
      label: sessionDisplayLabel(session),
      cwd: session.cwd,
      archived: session.archived === true,
      current: selectedSessionId === session.sessionId,
      statusClass: statusDotClassNames[session.status],
      session,
    })),
    ...workspaces.map((workspace) => ({
      key: `workspace-${workspace.sessionId}`,
      id: workspace.sessionId,
      kind: 'workspace' as const,
      label: workspace.title,
      cwd: workspace.cwd,
      archived: workspace.archived,
      current: selectedWorkspaceId === workspace.sessionId,
    })),
  ];
  const currentIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  const activeOptionKey = options[currentIndex]?.key;

  useEffect(() => {
    if (open) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, activeOptionKey]);

  const changeOpen = (nextOpen: boolean) => {
    onQueryChange('');
    setActiveIndex(0);
    setOpen(nextOpen);
  };

  const selectOption = (option: SearchOption) => {
    changeOpen(false);
    if (option.kind === 'chat') onSelectSession(option.id);
    else onSelectWorkspace(option.id);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((currentIndex + direction + options.length) % options.length);
    } else if (event.key === 'Enter' && options[currentIndex]) {
      event.preventDefault();
      selectOption(options[currentIndex]);
    }
  };

  const renderOption = (option: SearchOption, index: number) => {
    const active = index === currentIndex;
    const row = (
      <button
        key={option.key}
        ref={active ? activeOptionRef : undefined}
        id={`${listboxId}-${option.key}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={active}
        aria-current={option.current ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
          active ? 'bg-foreground/[0.065] text-foreground' : 'text-muted-foreground',
          option.current && !active && 'text-accent-ink',
        )}
        onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectOption(option)}
      >
        {option.kind === 'workspace' ? (
          <Users className="size-3.5 shrink-0 text-term-cyan" aria-hidden="true" />
        ) : (
          <span className={cn('mx-1 size-1.5 shrink-0 rounded-full', option.statusClass)} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate" title={option.session ? undefined : option.label}>
          {option.label}
        </span>
        {option.archived ? <span className="shrink-0 text-[10px] text-muted-foreground">Hidden</span> : null}
        <span className="max-w-[32%] shrink-0 truncate text-xs text-muted-foreground/75" title={option.session ? undefined : option.cwd}>
          {projectLabel(option.cwd)}
        </span>
      </button>
    );
    return option.session ? (
      <SessionHoverCard key={option.key} session={option.session}>
        {row}
      </SessionHoverCard>
    ) : (
      row
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon-sm" className="app-region-no-drag border-0 text-muted-foreground" aria-label="Search chats" title="Search chats">
          <Search className="size-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25" />
        <Dialog.Content
          className="app-region-no-drag fixed left-1/2 top-[15dvh] z-50 flex max-h-[70dvh] w-[min(calc(100vw-2rem),600px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-2xl focus:outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Search chats</Dialog.Title>
          <Dialog.Description className="sr-only">Find a chat or group chat. Use the arrow keys to choose a result and Enter to open it.</Dialog.Description>
          <div className="flex shrink-0 items-center gap-3 px-5 py-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              role="combobox"
              aria-label="Search chats"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={open}
              aria-activedescendant={activeOptionKey ? `${listboxId}-${activeOptionKey}` : undefined}
              placeholder="Search chats"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                setActiveIndex(0);
                onQueryChange(event.target.value);
              }}
              onKeyDown={handleInputKeyDown}
            />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-xs" className="border-0 text-muted-foreground" aria-label="Close search">
                <X className="size-3.5" />
              </Button>
            </Dialog.Close>
          </div>
          <div id={listboxId} role="listbox" aria-label="Chats and group chats" className="min-h-0 overflow-y-auto px-2 pb-2">
            {sessions.length > 0 ? (
              <div role="group" aria-labelledby={chatsHeadingId}>
                <div id={chatsHeadingId} className="px-3 pb-1.5 pt-1 text-xs text-muted-foreground">
                  Chats
                </div>
                {options.slice(0, sessions.length).map((option, index) => renderOption(option, index))}
              </div>
            ) : null}
            {workspaces.length > 0 ? (
              <div role="group" aria-labelledby={groupsHeadingId}>
                <div id={groupsHeadingId} className={cn('px-3 pb-1.5 pt-1 text-xs text-muted-foreground', sessions.length > 0 && 'mt-3')}>
                  Group chats
                </div>
                {options.slice(sessions.length).map((option, index) => renderOption(option, sessions.length + index))}
              </div>
            ) : null}
            {!options.length ? (
              <div role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query.trim() ? 'No chats match your search.' : 'No chats yet.'}
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
