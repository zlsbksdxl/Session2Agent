import { ArrowUp, Braces, Paperclip, Square, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { sessionDisplayLabel } from '@/lib/session-display';
import { providerOption } from '@/lib/provider-catalog';
import { NewChatSetupBar } from '@/components/new-chat-setup';
import { ChatOpenMenu } from '@/components/chat-open-menu';
import { RecoveryNotice } from '@/components/recovery';
import { SessionTerminalPanel } from '@/components/session-terminal-panel';
import { LiveSessionTimeline } from '@/components/live-session-timeline';
import { RuntimeInteractionPanel } from '@/components/runtime-interaction-panel';
import { LiveProviderEventDrawer } from '@/components/live-provider-event-drawer';
import { ProviderSetupDiagnostics } from '@/components/provider-settings';
import { ComposerAttachmentPill } from '@/components/composer-attachment-pill';
import { ComposerModelControls } from '@/components/composer-model-controls';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { type ProviderSetupStatus } from '@/shared/graph-state';
import { type RuntimeCoreState } from '@/hooks/use-runtime-core';
import { type LayoutPrefsState } from '@/hooks/use-layout-prefs';
import { type ComposerState } from '@/hooks/use-composer';
import { type NewChatSetupState } from '@/hooks/use-new-chat-setup';
import { type TerminalPanelState } from '@/hooks/use-terminal-panel';
import { type SessionActionsState } from '@/hooks/use-session-actions';
import { type InteractionsState } from '@/hooks/use-interactions';
import { type DiffPanelState } from '@/hooks/use-diff-panel';
import { providerSetupProfileFingerprint, selectProviderSetupProfile } from '@shared/provider-setup';
import { PlanCouncilCard } from '@/components/plan-council-card';
import { WorkflowProposalCard } from '@/components/workflow-proposal-card';
import { ThreadGoalProgressRow } from '@/components/thread-goal-progress-row';

const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

const sendShortcutHint = isMacPlatform ? '⌘⏎' : 'Ctrl+⏎';

type ChatDetailProps = {
  core: RuntimeCoreState;
  layout: LayoutPrefsState;
  composer: ComposerState;
  newChat: NewChatSetupState;
  terminal: TerminalPanelState;
  actions: SessionActionsState;
  interactions: InteractionsState;
  diff: DiffPanelState;
  showRawEvents: boolean;
  setShowRawEvents: Dispatch<SetStateAction<boolean>>;
  providerSetupSessionId?: string;
  setProviderSetupSessionId: Dispatch<SetStateAction<string | undefined>>;
  isWorkspacePanelOpen: boolean;
  setIsWorkspacePanelOpen: Dispatch<SetStateAction<boolean>>;
  onOpenPlanCouncil: (workflowId: string) => void;
  onOpenAgentSettings: () => void;
};

export function ChatDetail({
  core,
  layout,
  composer,
  newChat,
  terminal,
  actions,
  interactions,
  diff,
  showRawEvents,
  setShowRawEvents,
  providerSetupSessionId,
  setProviderSetupSessionId,
  isWorkspacePanelOpen,
  setIsWorkspacePanelOpen,
  onOpenPlanCouncil,
  onOpenAgentSettings,
}: ChatDetailProps) {
  const {
    runtimeClient,
    runtimeApi,
    isRuntimeAvailable,
    isElectron,
    runtimeHostPlatform,
    runtimeStatusText,
    runtimeUnavailableText,
    runtimeError,
    runtimeState,
    runtimeStateStore,
    setRuntimeState,
    setRuntimeError,
    selectedSession,
    openRuntimeRequests,
    openUserInputRequests,
    providerInstances,
    selectedRecoveryState,
    canResume,
    canKill,
    canActOnPlan,
  } = core;
  const selectedPlanCouncil = selectedSession
    ? Object.values(runtimeState.planCouncils ?? {}).find(
        (council) => council.coordinatorSessionId === selectedSession.sessionId || Boolean(council.participants[selectedSession.sessionId]),
      )
    : undefined;
  const selectedWorkflowProposals =
    selectedSession?.role === 'master'
      ? Object.values(runtimeState.workflowProposals ?? {})
          .filter((proposal) => proposal.proposedPlan.masterSessionId === selectedSession.sessionId)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      : [];
  const { openWorkspaceTarget, setOpenWorkspaceTarget, effectiveGraphCollapsed, graphForcedCollapsed, setGraphCollapsed } = layout;
  const {
    setMessage,
    composerAttachments,
    isComposerDragActive,
    setIsComposerDragActive,
    composerEditorRef,
    composerFileInputRef,
    addComposerFiles,
    removeComposerAttachment,
    handleComposerPaste,
    handleComposerDrop,
    composerHasPayload,
  } = composer;
  const {
    newProviderKind,
    newProviderInstanceId,
    newCwd,
    setNewCwd,
    newWorkMode,
    setNewWorkMode,
    newBranch,
    setNewBranch,
    newRuntimeMode,
    setNewRuntimeMode,
    newModel,
    setNewModel,
    newReasoningEffort,
    setNewReasoningEffort,
    providerSetupStatus,
    isLoadingProviderSetupStatus,
    savingProviderInstanceId,
    providerInstanceError,
    changeNewProviderKind,
    newCwdValidation,
    newChatProjects,
    chooseNewChatProject,
    saveProviderInstance,
  } = newChat;
  const providerSetupSession = selectedSession?.sessionId === providerSetupSessionId ? selectedSession : undefined;
  const providerSetupProviderKind = providerSetupSession?.providerKind;
  const providerSetupProviderInstanceId = providerSetupSession?.providerInstanceId;
  const providerSetupCwd = providerSetupSession?.cwd;
  const providerSetupProfile = providerSetupProviderKind
    ? selectProviderSetupProfile(providerInstances, providerSetupProviderKind, providerSetupProviderInstanceId)
    : undefined;
  const providerSetupProfileKey = providerSetupProfileFingerprint(providerSetupProfile);
  const [selectedProviderSetupStatus, setSelectedProviderSetupStatus] = useState<ProviderSetupStatus>();
  const [isLoadingSelectedProviderSetup, setIsLoadingSelectedProviderSetup] = useState(false);

  useEffect(() => {
    if (providerSetupSessionId && selectedSession?.sessionId !== providerSetupSessionId) {
      setProviderSetupSessionId(undefined);
    }
  }, [providerSetupSessionId, selectedSession?.sessionId, setProviderSetupSessionId]);

  useEffect(() => {
    if (!providerSetupProviderKind || !providerSetupProviderInstanceId || !runtimeApi) {
      setSelectedProviderSetupStatus(undefined);
      setIsLoadingSelectedProviderSetup(false);
      return;
    }
    let cancelled = false;
    setIsLoadingSelectedProviderSetup(true);
    runtimeApi
      .getProviderSetupStatus({
        providerKind: providerSetupProviderKind,
        providerInstanceId: providerSetupProviderInstanceId,
        cwd: providerSetupCwd,
      })
      .then((status) => {
        if (!cancelled) setSelectedProviderSetupStatus(status);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSelectedProviderSetupStatus({
          providerKind: providerSetupProviderKind,
          providerInstanceId: providerSetupProviderInstanceId,
          generatedAt: new Date().toISOString(),
          checks: [
            {
              id: 'setup-status',
              label: 'Setup status',
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSelectedProviderSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerSetupCwd, providerSetupProfileKey, providerSetupProviderInstanceId, providerSetupProviderKind, runtimeApi]);
  const {
    isTerminalPanelOpen,
    isOpeningTerminal,
    isSendingTerminalCommand,
    selectedTerminal,
    canOpenSelectedTerminal,
    openSelectedTerminal,
    runSelectedTerminalCommand,
    clearSelectedTerminal,
    closeSelectedTerminal,
  } = terminal;
  const {
    isCreating,
    isResuming,
    forkingMessageId,
    pendingLinkedSource,
    openingWorkspaceTarget,
    composerDisabled,
    canOpenSelectedWorkspace,
    sendChatMessage,
    controlSelectedThreadGoal,
    killSelectedSession,
    forkSessionFromMessage,
    openSelectedWorkspace,
    continueRuntimePlan,
    reviseRuntimePlan,
  } = actions;
  const { userInputDrafts, setUserInputDraft, pendingInteractionIds, respondToRuntimeRequest, answerRuntimeUserInput } = interactions;
  const { openTurnDiff } = diff;
  const providerBlockingCheck = !selectedSession
    ? providerSetupStatus?.checks.find((check) => check.status === 'error' && ['binary', 'auth', 'protocol'].includes(check.id))
    : undefined;
  const providerSetupMatchesSelection = Boolean(
    providerSetupStatus &&
    providerSetupStatus.providerKind === newProviderKind &&
    providerSetupStatus.providerInstanceId === newProviderInstanceId &&
    providerSetupStatus.profileFingerprint ===
      providerSetupProfileFingerprint(selectProviderSetupProfile(providerInstances, newProviderKind, newProviderInstanceId)) &&
    providerSetupStatus.cwd === newCwd.trim(),
  );
  const newProviderBlocked = Boolean(
    !selectedSession &&
    (isLoadingProviderSetupStatus ||
      !providerSetupMatchesSelection ||
      providerSetupStatus?.readiness === 'unavailable' ||
      providerSetupStatus?.auth?.status === 'unauthenticated' ||
      providerBlockingCheck),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="@container shrink-0 border-b border-border bg-card px-3.5 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={selectedSession ? sessionDisplayLabel(selectedSession) : undefined}>
                {selectedSession ? sessionDisplayLabel(selectedSession) : pendingLinkedSource ? 'New agent' : 'New chat'}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="app-region-no-drag size-7"
                    variant={showRawEvents || providerSetupSession ? 'secondary' : 'ghost'}
                    size="icon"
                    aria-label="Diagnostics"
                    onClick={() => {
                      if (providerSetupSession) {
                        setProviderSetupSessionId(undefined);
                      } else {
                        setShowRawEvents((current) => !current);
                      }
                    }}
                  >
                    <Braces className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Diagnostics</TooltipContent>
              </Tooltip>
              {selectedSession || effectiveGraphCollapsed ? (
                <ChatOpenMenu
                  showSessionActions={Boolean(selectedSession)}
                  target={openWorkspaceTarget}
                  platform={runtimeHostPlatform}
                  canOpenWorkspace={canOpenSelectedWorkspace}
                  pendingTarget={openingWorkspaceTarget}
                  onTargetChange={setOpenWorkspaceTarget}
                  onOpenWorkspace={openSelectedWorkspace}
                  canOpenWorkspaceFiles={Boolean(selectedSession?.cwd.trim())}
                  isWorkspaceFilesOpen={isWorkspacePanelOpen}
                  onWorkspaceFilesOpenChange={setIsWorkspacePanelOpen}
                  canOpenTerminal={canOpenSelectedTerminal}
                  isOpeningTerminal={isOpeningTerminal}
                  onOpenTerminal={openSelectedTerminal}
                  onShowGraph={effectiveGraphCollapsed ? () => setGraphCollapsed(false) : undefined}
                  graphUnavailable={graphForcedCollapsed}
                />
              ) : null}
            </div>
          </div>
        </div>
        {selectedRecoveryState ? (
          <div className="mt-2">
            <RecoveryNotice state={selectedRecoveryState} compact />
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <RuntimeInteractionPanel
          requests={openRuntimeRequests}
          userInputRequests={openUserInputRequests}
          userInputDrafts={userInputDrafts}
          pendingInteractionIds={pendingInteractionIds}
          onRespond={respondToRuntimeRequest}
          onDraftChange={setUserInputDraft}
          onAnswer={answerRuntimeUserInput}
        />

        {providerSetupSession ? (
          <ProviderSetupDiagnostics
            isRuntimeAvailable={isRuntimeAvailable}
            runtimeStatusText={runtimeStatusText}
            providerKind={providerSetupSession.providerKind}
            providerInstanceId={providerSetupSession.providerInstanceId}
            providerInstances={providerInstances}
            runtimeError={runtimeError}
            setupStatus={selectedProviderSetupStatus}
            isLoadingSetupStatus={isLoadingSelectedProviderSetup}
            savingProviderInstanceId={savingProviderInstanceId}
            providerInstanceError={providerInstanceError}
            onSaveProviderInstance={saveProviderInstance}
          />
        ) : showRawEvents ? (
          selectedSession ? (
            <LiveProviderEventDrawer runtimeStateStore={runtimeStateStore} sessionId={selectedSession.sessionId} />
          ) : (
            <ProviderSetupDiagnostics
              isRuntimeAvailable={isRuntimeAvailable}
              runtimeStatusText={runtimeStatusText}
              providerKind={newProviderKind}
              providerInstanceId={newProviderInstanceId}
              providerInstances={providerInstances}
              runtimeError={runtimeError}
              setupStatus={providerSetupStatus}
              isLoadingSetupStatus={isLoadingProviderSetupStatus}
              savingProviderInstanceId={savingProviderInstanceId}
              providerInstanceError={providerInstanceError}
              onSaveProviderInstance={saveProviderInstance}
            />
          )
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto bg-ink">
          {selectedWorkflowProposals.map((proposal) => (
            <WorkflowProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              runtimeState={runtimeState}
              runtimeApi={runtimeApi}
              onStateChange={setRuntimeState}
              onError={setRuntimeError}
              onOpenLive={onOpenPlanCouncil}
            />
          ))}
          {selectedPlanCouncil ? (
            <PlanCouncilCard
              council={selectedPlanCouncil}
              runtimeApi={runtimeApi}
              onStateChange={setRuntimeState}
              onError={setRuntimeError}
              onOpen={() => onOpenPlanCouncil(selectedPlanCouncil.workflowId)}
            />
          ) : null}
          <LiveSessionTimeline
            runtimeStateStore={runtimeStateStore}
            sessionId={selectedSession?.sessionId}
            session={selectedSession}
            agent={selectedSession?.agent}
            canActOnPlan={canActOnPlan}
            onContinuePlan={continueRuntimePlan}
            onRevisePlan={reviseRuntimePlan}
            onOpenTurnDiff={openTurnDiff}
            forkingMessageId={forkingMessageId}
            canForkSession={isRuntimeAvailable}
            onForkMessage={forkSessionFromMessage}
          />
        </div>

        {isTerminalPanelOpen && selectedTerminal ? (
          <SessionTerminalPanel
            terminal={selectedTerminal}
            isOpening={isOpeningTerminal}
            isSending={isSendingTerminalCommand}
            onSubmit={runSelectedTerminalCommand}
            onClear={clearSelectedTerminal}
            onClose={closeSelectedTerminal}
          />
        ) : null}

        <div className="shrink-0 border-t border-border bg-card p-2.5">
          {!selectedSession ? (
            <>
              {pendingLinkedSource ? (
                <div className="app-region-no-drag mb-2 rounded-lg border border-accent-ink/25 bg-accent-ink/[0.06] px-3 py-2 font-mono text-[10.5px] leading-4 text-muted-foreground">
                  <span className="font-medium text-foreground">Creating one agent from {pendingLinkedSource.label}.</span> This records where it came from; it
                  does not add ongoing automation. Use New workflow to keep agents connected.
                </div>
              ) : null}
              {!isRuntimeAvailable ? (
                <div className="app-region-no-drag mb-2 flex items-start gap-2 rounded-lg border border-term-amber/35 bg-term-amber/10 px-3 py-2 font-mono text-[11px] leading-4 text-term-amber">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">{runtimeUnavailableText}</span>
                </div>
              ) : runtimeClient.kind === 'http' ? (
                <div className="app-region-no-drag mb-2 flex items-start gap-2 rounded-lg border border-term-amber/35 bg-term-amber/10 px-3 py-2 font-mono text-[11px] leading-4 text-term-amber">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">Folder picker is unavailable in web runtime. Enter a project path manually.</span>
                </div>
              ) : null}
              {isRuntimeAvailable && !isLoadingProviderSetupStatus && newProviderBlocked ? (
                <div className="app-region-no-drag mb-2 flex items-center gap-2 rounded-lg border border-term-rose/35 bg-term-rose/10 px-3 py-2 font-mono text-[11px] leading-4 text-term-rose">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {providerBlockingCheck?.message ?? `${providerOption(newProviderKind).label} needs setup before it can start a chat.`}
                  </span>
                  <Button className="h-7 shrink-0 font-mono text-[10px] tracking-[0.07em]" variant="outline" size="sm" onClick={onOpenAgentSettings}>
                    Agent settings
                  </Button>
                </div>
              ) : null}
              <NewChatSetupBar
                projects={newChatProjects}
                projectCwd={newCwd}
                validation={newCwdValidation}
                providerKind={newProviderKind}
                workMode={newWorkMode}
                branch={newBranch}
                runtimeMode={newRuntimeMode}
                disabled={isCreating || !isRuntimeAvailable}
                canChooseProject={isElectron}
                onProjectChange={setNewCwd}
                onChooseProject={chooseNewChatProject}
                onProviderKindChange={changeNewProviderKind}
                onWorkModeChange={setNewWorkMode}
                onBranchChange={setNewBranch}
                onRuntimeModeChange={setNewRuntimeMode}
              />
            </>
          ) : null}
          {selectedSession?.threadGoal ? (
            <ThreadGoalProgressRow
              goal={selectedSession.threadGoal}
              sessionRunning={selectedSession.status === 'running' || selectedSession.status === 'pending'}
              busy={isResuming}
              onPause={() => void controlSelectedThreadGoal({ kind: 'pause' })}
              onResume={() => void controlSelectedThreadGoal({ kind: 'resume' })}
              onClear={() => void controlSelectedThreadGoal({ kind: 'clear' })}
            />
          ) : null}
          <input
            ref={composerFileInputRef}
            className="hidden"
            type="file"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) {
                void addComposerFiles(event.currentTarget.files);
              }
              event.currentTarget.value = '';
            }}
          />
          <div
            className={cn(
              'app-region-no-drag @container mb-2 rounded-xl border border-ink-line bg-ink transition focus-within:border-term-accent-hi/55 focus-within:ring-1 focus-within:ring-term-accent-hi/25',
              isComposerDragActive && 'border-term-accent-hi/60 bg-term-accent/[0.05] ring-1 ring-term-accent-hi/25',
            )}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                setIsComposerDragActive(true);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault();
              }
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget;
              if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                setIsComposerDragActive(false);
              }
            }}
            onDrop={handleComposerDrop}
          >
            {composerAttachments.length > 0 ? (
              <div className="grid gap-1.5 border-b border-ink-line-2 px-2.5 py-2">
                {composerAttachments.map((attachment) => (
                  <ComposerAttachmentPill key={attachment.id} attachment={attachment} disabled={composerDisabled} onRemove={removeComposerAttachment} />
                ))}
              </div>
            ) : null}
            <div className="flex cursor-text gap-2 px-3.5 pb-1 pt-3" onClick={() => composerEditorRef.current?.focus()}>
              <span
                className={cn('select-none font-mono text-[13px] leading-6 transition-colors', composerDisabled ? 'text-term-faint' : 'text-term-accent-hi')}
                aria-hidden="true"
              >
                ❯
              </span>
              <div
                ref={composerEditorRef}
                className="orrery-composer-editor max-h-40 min-h-6 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono text-[13px] leading-6 text-term-name outline-none"
                role="textbox"
                aria-multiline="true"
                aria-disabled={composerDisabled}
                contentEditable={!composerDisabled}
                data-placeholder={selectedSession ? 'Message this chat' : pendingLinkedSource ? 'Describe what this agent should do' : 'Start a new chat'}
                suppressContentEditableWarning
                onInput={(event) => setMessage(event.currentTarget.innerText)}
                onPaste={handleComposerPaste}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (!newProviderBlocked) void sendChatMessage();
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-1 px-2 pb-2 pt-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="size-8 shrink-0 text-term-dim hover:text-term-name"
                    variant="ghost"
                    size="icon-sm"
                    disabled={composerDisabled}
                    aria-label="Attach files"
                    onClick={() => composerFileInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach files — or drag and drop, or paste</TooltipContent>
              </Tooltip>
              <div className="ml-auto flex min-w-0 items-center gap-2">
                {composerHasPayload && !canKill ? (
                  <span className="hidden font-mono text-[10px] text-term-faint @[26rem]:inline">{sendShortcutHint}</span>
                ) : null}
                {!selectedSession ? (
                  <ComposerModelControls
                    providerKind={newProviderKind}
                    model={newModel}
                    reasoningEffort={newReasoningEffort}
                    discoveredModels={providerSetupStatus?.models?.availableModels}
                    currentModelId={providerSetupStatus?.models?.currentModelId}
                    disabled={isCreating || !isRuntimeAvailable}
                    onModelChange={setNewModel}
                    onReasoningEffortChange={setNewReasoningEffort}
                  />
                ) : null}
                {canKill ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="size-8 shrink-0 rounded-full"
                        variant="destructive"
                        size="icon-sm"
                        disabled={!isRuntimeAvailable || !selectedSession || !canKill}
                        aria-label="Stop"
                        onClick={killSelectedSession}
                      >
                        <Square className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop this run</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="size-8 shrink-0 rounded-full"
                        size="icon-sm"
                        disabled={
                          !isRuntimeAvailable ||
                          (selectedSession ? !canResume || isResuming : isCreating || !newCwdValidation.ok || newProviderBlocked) ||
                          !composerHasPayload
                        }
                        aria-label={!selectedSession && pendingLinkedSource ? 'Create agent' : 'Send'}
                        onClick={sendChatMessage}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!selectedSession && pendingLinkedSource ? `Create agent · ${sendShortcutHint}` : `Send · ${sendShortcutHint}`}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
