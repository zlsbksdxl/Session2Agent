import { workspaceMatchesSearch } from '@/lib/collaboration-display';
import type { CollaborationSession } from '@shared/collaboration';
import {
  Users,
  Archive,
  Orbit,
  type LucideIcon,
  ArchiveRestore,
  ChevronDown,
  Eye,
  EyeClosed,
  FileText,
  GitBranch,
  Import,
  MessageSquarePlus,
  Pin,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { statusDotClassNames, sessionDisplayLabel, firstOpenRequests, lastMessagePreview } from '@/lib/session-display';
import { defaultRailSidebarWidth, railSidebarMinWidth, railSidebarMaxWidth, type RailTab } from '@/lib/layout-prefs';
import { formatRelativeTime, formatTimestamp, firstContentLine } from '@/lib/format';
import { sessionRecoveryState } from '@/lib/diagnostics';
import { RecoveryNotice } from '@/components/recovery';
import { type Dispatch, type SetStateAction, useEffect, useId, useRef, useState } from 'react';
import { type AgentSession } from '@/shared/graph-state';
import { type RuntimeRequest, type UserInputRequest } from '@/shared/provider-runtime';
import { type RuntimeCoreState } from '@/hooks/use-runtime-core';
import { type SessionListState } from '@/hooks/use-session-list';
import { type SessionActionsState } from '@/hooks/use-session-actions';
import { type InteractionsState } from '@/hooks/use-interactions';
import { AppUpdateNotice } from '@/components/app-update-notice';
import { SidebarSettings } from '@/components/sidebar-settings';
import { ChatSearchDialog } from '@/components/chat-search-dialog';
import { SessionHoverCard } from '@/components/session-hover-card';
import type { LayoutPrefsState } from '@/hooks/use-layout-prefs';

const railTabs: { id: RailTab; label: string; icon: LucideIcon }[] = [{ id: 'orchestrate', label: 'Advanced', icon: Orbit }];

type SidebarRailProps = {
  core: RuntimeCoreState;
  layout: LayoutPrefsState;
  sessionList: SessionListState;
  actions: SessionActionsState;
  interactions: InteractionsState;
  activeTab: RailTab;
  setActiveTab: Dispatch<SetStateAction<RailTab>>;
  onStartWorkflow: () => void;
  onImportChat: () => void;
  onNewWorkspace: () => void;
  onOpenWorkspace: (id: string) => void;
  selectedWorkspaceId?: string;
};

type SessionTier = 'attention' | 'running' | 'recent';

type SessionEntry = {
  session: AgentSession;
  recovery: ReturnType<typeof sessionRecoveryState>;
  openRequests: RuntimeRequest[];
  openInputs: UserInputRequest[];
  tier: SessionTier;
};

// "2m ago" reads fine in a card body but eats width in one-line rows.
function compactTime(value?: string) {
  return formatRelativeTime(value).replace(' ago', '');
}

function SectionHeader({ label, count, toneCls }: { label: string; count?: number; toneCls: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-3.5 font-mono text-[11px] first:pt-1">
      <span className={toneCls}>{label}</span>
      {count !== undefined ? <span className={cn('tabular-nums', toneCls)}>{count}</span> : null}
      <span className="h-px min-w-0 flex-1 bg-ink-line" />
    </div>
  );
}

export function SidebarRail({
  core,
  layout,
  sessionList,
  actions,
  interactions,
  activeTab,
  setActiveTab,
  onStartWorkflow,
  onImportChat,
  onNewWorkspace,
  onOpenWorkspace,
  selectedWorkspaceId,
}: SidebarRailProps) {
  const { isRuntimeAvailable, isElectron, runtimeState, selectedSessionId, selectedSession, setSelectedSessionId, sessions, runtimeDiagnostics } = core;
  const {
    sessionSearch,
    setSessionSearch,
    showArchivedSessions,
    setShowArchivedSessions,
    archivingSessionIds,
    runningSessions,
    archivedSessionCount,
    filteredSessions,
    setSessionArchived,
    pinnedSessionIds,
    toggleSessionPinned,
  } = sessionList;
  const [isRecentsExpanded, setIsRecentsExpanded] = useState(true);
  const recentsListId = useId();
  const pinButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingPinFocusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const sessionId = pendingPinFocusRef.current;
    pendingPinFocusRef.current = undefined;
    if (!sessionId) return;
    const button = pinButtonRefs.current.get(sessionId);
    // Focus the row first so focus-within reveals an unpinned action button.
    button?.closest<HTMLElement>('[role="button"]')?.focus({ preventScroll: true });
    button?.focus({ preventScroll: true });
  }, [pinnedSessionIds]);

  const { setPendingLinkedSourceId, startNewChat, startLinkedChat } = actions;
  const { respondToRuntimeRequest, pendingInteractionIds } = interactions;
  const archivedChatCount = archivedSessionCount + Object.values(runtimeState.collaborationSessions ?? {}).filter((workspace) => workspace.archived).length;
  const archiveVisibilityLabel = `${showArchivedSessions ? 'Hide' : 'Show'} archived chats (${archivedChatCount})`;

  const selectSession = (sessionId: string) => {
    setPendingLinkedSourceId(null);
    setSelectedSessionId(sessionId);
    setActiveTab('chat');
  };

  const pinnedIds = new Set(pinnedSessionIds);
  const pinRanks = new Map(pinnedSessionIds.map((id, index) => [id, index]));
  const workspaceEntries = Object.values(runtimeState.collaborationSessions ?? {})
    .filter((workspace) => (showArchivedSessions || !workspace.archived) && workspaceMatchesSearch(workspace, sessionSearch))
    .sort(
      (a, b) =>
        (pinRanks.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER) - (pinRanks.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );

  const entries: SessionEntry[] = filteredSessions.map((session) => {
    const node = runtimeState.nodes.find((candidate) => candidate.sessionId === session.sessionId);
    const managedCluster = Object.values(runtimeState.clusters).find((cluster) => cluster.nodeIds.includes(session.sessionId));
    const recovery = sessionRecoveryState({
      session,
      diagnostics: runtimeDiagnostics,
      frozen: node?.frozen === true || managedCluster?.frozen === true,
    });
    const { openRequests, openInputs } = firstOpenRequests(session);
    // Failed/killed sessions are terminal, not actionable — they get a rose or
    // amber dot in Recent (their recovery notice still shows in the chat pane).
    // Only recovery states beyond plain failure (invalid cwd, frozen, recovered
    // runtime) pin a session to the attention tier.
    const actionableRecovery = recovery && session.status !== 'failed' && session.status !== 'killed' ? recovery : undefined;
    const tier: SessionTier =
      openRequests.length > 0 || openInputs.length > 0 || actionableRecovery
        ? 'attention'
        : session.status === 'running' || session.status === 'pending'
          ? 'running'
          : 'recent';
    return { session, recovery: actionableRecovery, openRequests, openInputs, tier };
  });

  const entryById = new Map(entries.map((entry) => [entry.session.sessionId, entry]));
  const workspaceById = new Map(workspaceEntries.map((workspace) => [workspace.sessionId, workspace]));
  const visiblePinnedIds = pinnedSessionIds.filter((id) => entryById.has(id) || workspaceById.has(id));
  const unpinnedWorkspaces = workspaceEntries.filter((workspace) => !pinnedIds.has(workspace.sessionId));
  const attentionEntries = entries.filter((entry) => entry.tier === 'attention' && !pinnedIds.has(entry.session.sessionId));
  const runningEntries = entries.filter((entry) => entry.tier === 'running' && !pinnedIds.has(entry.session.sessionId));
  const recentEntries = entries.filter((entry) => entry.tier === 'recent' && !pinnedIds.has(entry.session.sessionId));

  const renderPinButton = (sessionId: string) => {
    const pinned = pinnedIds.has(sessionId);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={(element) => {
              if (element) pinButtonRefs.current.set(sessionId, element);
              else pinButtonRefs.current.delete(sessionId);
            }}
            aria-label={pinned ? 'Unpin chat' : 'Pin chat'}
            aria-pressed={pinned}
            className={cn(
              'shrink-0 rounded-md p-1 transition hover:bg-foreground/[0.07] focus-visible:outline-2 focus-visible:outline-ring/70',
              pinned ? 'text-term-accent-hi' : 'hidden text-term-dim2 hover:text-term-name group-hover/chat:inline-flex group-focus-within/chat:inline-flex',
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (document.activeElement === event.currentTarget) pendingPinFocusRef.current = sessionId;
              toggleSessionPinned(sessionId);
            }}
          >
            <Pin className={cn('size-3.5', pinned && 'fill-current')} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{pinned ? 'Unpin chat' : 'Pin chat'}</TooltipContent>
      </Tooltip>
    );
  };

  const renderArchiveButton = (session: AgentSession, extraCls?: string) => {
    const canArchive = session.status !== 'running' && session.status !== 'pending';
    const archivePending = archivingSessionIds[session.sessionId] === true;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-md p-1 text-term-dim2 opacity-0 transition hover:bg-foreground/[0.07] hover:text-term-name group-focus-within/chat:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed',
              extraCls,
            )}
            disabled={!isRuntimeAvailable || archivePending || !canArchive}
            aria-label={session.archived ? 'Restore chat' : 'Hide chat'}
            onClick={(event) => {
              event.stopPropagation();
              void setSessionArchived(session.sessionId, !session.archived);
            }}
          >
            {session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{session.archived ? 'Restore chat' : 'Hide chat'}</TooltipContent>
      </Tooltip>
    );
  };

  const renderAttentionCard = (entry: SessionEntry) => {
    const { session, recovery, openRequests, openInputs } = entry;
    const request = openRequests[0];
    const input = openInputs[0];
    const isSel = selectedSessionId === session.sessionId;
    const requestPending = request ? pendingInteractionIds[request.id] === true : false;
    const extraCount = openRequests.length + openInputs.length - 1;

    const toneBg = !request && input ? 'bg-term-cyan/[0.06] hover:bg-term-cyan/10' : 'bg-term-amber/[0.06] hover:bg-term-amber/10';

    return (
      <SessionHoverCard key={session.sessionId} session={session}>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'group/chat cursor-pointer rounded-lg p-2.5 font-mono transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
            isSel ? 'bg-term-accent-hi/10' : toneBg,
            session.archived && 'opacity-60',
          )}
          onClick={() => selectSession(session.sessionId)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectSession(session.sessionId);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span className={cn('size-1.5 shrink-0 rounded-full', !request && input ? 'bg-term-cyan' : 'bg-term-amber')} />
            <span className={cn('min-w-0 flex-1 truncate text-[12.5px] font-medium', isSel ? 'text-term-accent-hi' : 'text-term-name')}>
              {sessionDisplayLabel(session)}
            </span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-term-dim2">
              {compactTime(request?.createdAt ?? input?.createdAt ?? session.updatedAt)}
            </span>
            {renderPinButton(session.sessionId)}
            {renderArchiveButton(session, 'group-hover/chat:opacity-100 -my-1 -mr-1')}
          </div>

          {request || input ? (
            <div className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-[11.5px] leading-4">
              {request ? (
                <>
                  <span className="shrink-0 font-medium text-term-amber">Approve:</span>
                  <span className="min-w-0 flex-1 truncate text-term-dim" title={request.title}>
                    {request.title}
                  </span>
                </>
              ) : input ? (
                <>
                  <span className="shrink-0 font-medium text-term-cyan">Asked:</span>
                  <span className="min-w-0 flex-1 truncate text-term-dim" title={input.prompt}>
                    {firstContentLine(input.prompt) ?? input.prompt}
                  </span>
                </>
              ) : null}
              {extraCount > 0 ? <span className="shrink-0 text-[10px] text-term-faint">+{extraCount} more</span> : null}
            </div>
          ) : null}

          {request ? (
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                className="text-[11px] text-term-amber transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!isRuntimeAvailable || requestPending}
                onClick={(event) => {
                  event.stopPropagation();
                  void respondToRuntimeRequest(request, 'accept');
                }}
              >
                ✓ Approve
              </button>
            </div>
          ) : input ? (
            <div className="mt-1 flex justify-end">
              <span className="text-[11px] text-term-cyan">Answer →</span>
            </div>
          ) : null}

          {recovery ? (
            <div className="mt-2">
              <RecoveryNotice state={recovery} compact />
            </div>
          ) : null}
        </div>
      </SessionHoverCard>
    );
  };

  const renderRunningCard = (entry: SessionEntry) => {
    const { session } = entry;
    const isSel = selectedSessionId === session.sessionId;
    const isPendingStart = session.status === 'pending';
    return (
      <SessionHoverCard key={session.sessionId} session={session}>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'group/chat cursor-pointer rounded-lg p-2.5 font-mono transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
            isSel ? 'bg-term-accent-hi/10' : 'hover:bg-foreground/[0.045]',
          )}
          onClick={() => selectSession(session.sessionId)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectSession(session.sessionId);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span className={cn('size-1.5 shrink-0 animate-pulse rounded-full', isPendingStart ? 'bg-term-amber' : 'bg-term-green')} />
            <span className={cn('min-w-0 flex-1 truncate text-[12.5px] font-medium', isSel ? 'text-term-accent-hi' : 'text-term-name')}>
              {sessionDisplayLabel(session)}
            </span>
            {session.role === 'master' ? <span className="shrink-0 text-[9px] tracking-[0.1em] text-term-amber">Master</span> : null}
            <span className="shrink-0 text-[10.5px] tabular-nums text-term-dim2" title={`Started ${formatTimestamp(session.startedAt ?? session.createdAt)}`}>
              {compactTime(session.startedAt ?? session.updatedAt)}
            </span>
            {renderPinButton(session.sessionId)}
          </div>
          <div className="mt-1.5 truncate text-[11px] leading-4 text-term-dim">
            {isPendingStart ? 'Starting…' : (firstContentLine(lastMessagePreview(session)) ?? '…')}
          </div>
          <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className={cn(
                'h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r to-transparent',
                isPendingStart ? 'from-term-amber/60' : 'from-term-green/60',
              )}
            />
          </div>
        </div>
      </SessionHoverCard>
    );
  };

  const renderRecentRow = (entry: SessionEntry) => {
    const { session } = entry;
    const isSel = selectedSessionId === session.sessionId;
    return (
      <SessionHoverCard key={session.sessionId} session={session}>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'group/chat flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] font-mono transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
            isSel ? 'bg-term-accent-hi/10' : 'hover:bg-foreground/[0.045]',
            session.archived && 'opacity-60',
          )}
          onClick={() => selectSession(session.sessionId)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectSession(session.sessionId);
            }
          }}
        >
          {session.role === 'master' ? (
            <span className="w-1.5 shrink-0 text-center text-[7px] leading-none text-term-amber">◆</span>
          ) : (
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDotClassNames[session.status])} />
          )}
          <span className={cn('min-w-0 flex-1 truncate text-[12px]', isSel ? 'text-term-accent-hi' : 'text-term-dim')}>{sessionDisplayLabel(session)}</span>
          {session.archived ? <span className="shrink-0 text-[9px] tracking-[0.1em] text-term-faint">Hidden</span> : null}
          <span
            className="shrink-0 text-[10.5px] tabular-nums text-term-dim2 group-hover/chat:hidden group-focus-within/chat:hidden"
            title={`Created ${formatTimestamp(session.createdAt)} · updated ${formatTimestamp(session.updatedAt)}`}
          >
            {compactTime(session.updatedAt)}
          </span>
          {renderPinButton(session.sessionId)}
          {renderArchiveButton(session, '-my-1 -mr-1 hidden group-hover/chat:block group-focus-within/chat:block group-hover/chat:opacity-100')}
        </div>
      </SessionHoverCard>
    );
  };

  const renderWorkspaceCard = (workspace: CollaborationSession) => {
    const discussion = workspace.activeDiscussionId ? workspace.discussions[workspace.activeDiscussionId] : undefined;
    const attention = workspace.members.some((member) => member.attention);
    return (
      <div
        key={workspace.sessionId}
        role="button"
        tabIndex={0}
        onClick={() => onOpenWorkspace(workspace.sessionId)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenWorkspace(workspace.sessionId);
          }
        }}
        className={cn(
          'group/chat w-full cursor-pointer rounded-lg p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
          activeTab === 'workspace' && selectedWorkspaceId === workspace.sessionId ? 'bg-accent-ink/10' : 'hover:bg-accent',
          workspace.archived && 'opacity-60',
        )}
      >
        <span className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-term-cyan" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.title}</span>
          {renderPinButton(workspace.sessionId)}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{workspace.members.map((member) => member.label).join(', ')}</span>
        <span className={cn('mt-2 block text-xs', attention ? 'text-destructive' : 'text-muted-foreground')}>
          {workspace.archived ? 'Archived' : attention ? 'Needs attention' : discussion ? `Together · ${discussion.status}` : 'Group chat'} ·{' '}
          {compactTime(workspace.updatedAt)}
        </span>
      </div>
    );
  };

  const renderSessionEntry = (entry: SessionEntry) => {
    if (entry.tier === 'attention') return renderAttentionCard(entry);
    if (entry.tier === 'running') return renderRunningCard(entry);
    return renderRecentRow(entry);
  };

  return (
    <aside
      className="orrery-sidebar relative flex h-dvh min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar"
      style={{ width: layout.sidebarWidth }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={railSidebarMinWidth}
        aria-valuemax={railSidebarMaxWidth}
        aria-valuenow={Math.round(layout.sidebarWidth)}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        className={cn(
          'app-region-no-drag group/sidebar-resize absolute inset-y-0 right-0 z-30 flex w-1.5 cursor-col-resize touch-none justify-end outline-none',
          'focus-visible:bg-accent',
        )}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          layout.startResizingSidebar(event.pointerId);
        }}
        onLostPointerCapture={layout.stopResizingPanels}
        onDoubleClick={() => layout.changeSidebarWidth(defaultRailSidebarWidth)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 24 : 12;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            layout.adjustSidebarWidth(event.key === 'ArrowLeft' ? -step : step);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            layout.changeSidebarWidth(event.key === 'Home' ? railSidebarMinWidth : railSidebarMaxWidth);
          }
        }}
      >
        <span
          className={cn(
            'h-full w-px transition-colors group-hover/sidebar-resize:bg-accent-ink/40 group-focus-visible/sidebar-resize:bg-accent-ink',
            layout.isResizingSidebar ? 'bg-accent-ink/60' : 'bg-transparent',
          )}
        />
      </div>
      <header className={cn('app-region-drag flex shrink-0 items-center justify-between gap-3 px-4 py-3', isElectron && 'pt-9')}>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">SessionFlow</h1>
        </div>
        <ChatSearchDialog
          query={sessionSearch}
          onQueryChange={setSessionSearch}
          sessions={filteredSessions}
          workspaces={workspaceEntries}
          selectedSessionId={selectedSessionId ?? undefined}
          selectedWorkspaceId={activeTab === 'workspace' ? selectedWorkspaceId : undefined}
          onSelectSession={selectSession}
          onSelectWorkspace={onOpenWorkspace}
        />
      </header>
      <div className="app-region-no-drag grid shrink-0 gap-1.5 px-3 pb-2">
        <Button className="h-9 w-full justify-start gap-2 border-0 px-3 font-mono text-[12px] tracking-[0.08em]" variant="ghost" onClick={startNewChat}>
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
        {activeTab === 'chat' && selectedSession ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-9 w-full justify-start gap-2 border-0 px-3 font-mono text-[12px] tracking-[0.08em]"
                variant="ghost"
                disabled={!isRuntimeAvailable}
                aria-label="Create agent from this chat"
                onClick={startLinkedChat}
              >
                <GitBranch className="size-4" />
                New agent
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Create one agent from this chat. Use New workflow for ongoing automation.</TooltipContent>
          </Tooltip>
        ) : null}
        <Button className="h-9 w-full justify-start gap-2 border-0 px-3 font-mono text-[12px] tracking-[0.08em]" variant="ghost" onClick={onNewWorkspace}>
          <Users className="size-4" />
          New group chat
        </Button>
        <Button className="h-9 w-full justify-start gap-2 border-0 px-3 font-mono text-[12px] tracking-[0.08em]" variant="ghost" onClick={onStartWorkflow}>
          <Workflow className="size-4" />
          New workflow
        </Button>
        <Button
          className="h-8 w-full justify-start gap-2 border-0 px-3 font-mono text-[11px] tracking-[0.06em]"
          variant="ghost"
          disabled={!isRuntimeAvailable}
          onClick={onImportChat}
        >
          <Import className="size-4" />
          Import chat
        </Button>
      </div>
      <div className="app-region-no-drag shrink-0 px-3 pb-3 pt-1">
        <div className="flex items-center gap-1 p-1">
          {railTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
                  isActive ? 'bg-accent-ink/12 text-accent-ink' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <TabIcon className="size-3.5 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="app-region-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pb-2.5 pt-3 font-mono">
            <div className="group/recents flex items-center gap-2 text-[12px]">
              <button
                type="button"
                aria-label={isRecentsExpanded ? 'Collapse recent chats' : 'Expand recent chats'}
                aria-expanded={isRecentsExpanded}
                aria-controls={recentsListId}
                className="inline-flex min-w-0 items-center gap-1 rounded py-1 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70"
                onClick={() => setIsRecentsExpanded((current) => !current)}
              >
                <span>Recents</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover/recents:opacity-100 group-focus-within/recents:opacity-100 [@media(hover:none)]:opacity-100',
                    !isRecentsExpanded && '-rotate-90 opacity-100',
                  )}
                />
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={archiveVisibilityLabel}
                    aria-pressed={showArchivedSessions}
                    className={cn(
                      'ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/70',
                      showArchivedSessions ? 'text-[#5b8def] dark:text-[#7aa6ff]' : 'text-term-dim hover:bg-foreground/[0.045]',
                    )}
                    onClick={() => setShowArchivedSessions((current) => !current)}
                  >
                    {showArchivedSessions ? <Eye className="size-4" aria-hidden="true" /> : <EyeClosed className="size-4" aria-hidden="true" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{archiveVisibilityLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div id={recentsListId} role="region" aria-label="Recent chats" hidden={!isRecentsExpanded} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {sessions.length === 0 && workspaceEntries.length === 0 ? (
              <div className="p-5 text-center font-mono text-sm text-term-dim2">No chats yet.</div>
            ) : null}

            {sessions.length > 0 && filteredSessions.length === 0 && workspaceEntries.length === 0 ? (
              <div className="p-5 text-center font-mono text-sm text-term-dim2">No chats match the current search.</div>
            ) : null}

            {visiblePinnedIds.length > 0 ? (
              <div role="group" className="space-y-1.5" aria-label="Pinned chats">
                {visiblePinnedIds.map((id) => {
                  const entry = entryById.get(id);
                  if (entry) return renderSessionEntry(entry);
                  const workspace = workspaceById.get(id);
                  return workspace ? renderWorkspaceCard(workspace) : null;
                })}
              </div>
            ) : null}

            {unpinnedWorkspaces.length > 0 ? (
              <>
                <SectionHeader label="Group chats" count={unpinnedWorkspaces.length} toneCls="text-term-cyan" />
                <div className="space-y-1.5">{unpinnedWorkspaces.map(renderWorkspaceCard)}</div>
              </>
            ) : null}

            {attentionEntries.length > 0 ? (
              <>
                <SectionHeader label="Need attention" count={attentionEntries.length} toneCls="text-term-amber" />
                <div className="space-y-1.5">{attentionEntries.map(renderAttentionCard)}</div>
              </>
            ) : null}

            {runningEntries.length > 0 ? (
              <>
                <SectionHeader label="Working" count={runningEntries.length} toneCls="text-term-green" />
                <div className="space-y-1.5">{runningEntries.map(renderRunningCard)}</div>
              </>
            ) : null}

            {recentEntries.length > 0 ? (
              <div
                className={cn(
                  'space-y-px',
                  (visiblePinnedIds.length > 0 || unpinnedWorkspaces.length > 0 || attentionEntries.length > 0 || runningEntries.length > 0) && 'mt-3',
                )}
              >
                {recentEntries.map(renderRecentRow)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {isElectron ? <AppUpdateNotice /> : null}
      <footer className="app-region-no-drag flex shrink-0 items-center gap-3 border-t border-border px-2 py-1.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
        <SidebarSettings activeTab={activeTab} onOpenAgentSettings={() => setActiveTab('agents')} onOpenAppearance={() => setActiveTab('appearance')} />
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5" title={`${runningSessions.length} running / ${sessions.length} total chats`}>
            <span className={cn('size-1.5 rounded-full', runningSessions.length > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
            <span className="tabular-nums text-foreground/80">
              {runningSessions.length}/{sessions.length}
            </span>
          </span>
          <Separator orientation="vertical" className="h-3" />
          <span className="flex items-center gap-1" title="Links">
            <GitBranch className="size-3" />
            <span className="tabular-nums">{runtimeState.edges.length}</span>
          </span>
          <span className="flex items-center gap-1" title="Reports">
            <FileText className="size-3" />
            <span className="tabular-nums">{runtimeState.reports.length}</span>
          </span>
        </div>
      </footer>
    </aside>
  );
}
