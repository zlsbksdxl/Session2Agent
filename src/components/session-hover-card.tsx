import type { ReactElement } from 'react';
import { Clock3, FolderOpen, Hash } from 'lucide-react';
import { HoverCard } from 'radix-ui';
import type { AgentSession } from '@/shared/graph-state';
import { formatTimestamp } from '@/lib/format';
import { runtimeConfigSummary } from '@/lib/provider-catalog';
import { sessionChatId, sessionDisplayLabel, sessionProviderLabel, statusDotClassNames, statusLabels } from '@/lib/session-display';
import { cn } from '@/lib/utils';

function SessionDetails({ session }: { session: AgentSession }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 break-words text-sm font-medium leading-5">{sessionDisplayLabel(session)}</p>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', statusDotClassNames[session.status])} />
          {statusLabels[session.status]}
        </span>
      </div>
      <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">
        {sessionProviderLabel(session)} · {runtimeConfigSummary(session.providerKind, session.runtimeSettings, session.effectiveRuntimeConfig)}
      </p>
      <div className="mt-3 space-y-2.5 border-t border-border pt-3 text-xs leading-5">
        <div className="flex items-start gap-2.5">
          <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 break-all" aria-label="Project directory">
            {session.cwd.trim() || 'No project'}
          </span>
        </div>
        <div className="flex items-start gap-2.5 text-muted-foreground">
          <Hash className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-all font-mono text-[11px]" aria-label="Chat ID">
            {sessionChatId(session)}
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Updated {formatTimestamp(session.updatedAt)}</span>
        </div>
      </div>
    </>
  );
}

export function SessionHoverCard({ session, children }: { session: AgentSession; children: ReactElement }) {
  return (
    <HoverCard.Root openDelay={500} closeDelay={150}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Chat details"
          className="app-region-no-drag pointer-events-auto z-50 max-h-[calc(100dvh-1.5rem)] w-80 max-w-[calc(100vw-1.5rem)] select-text overflow-y-auto rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-lg outline-none"
        >
          <SessionDetails session={session} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
