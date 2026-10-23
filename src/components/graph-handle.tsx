import { Handle, useNodeConnections, type HandleProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

export function GraphHandle({ id, type, className, title, ...props }: HandleProps) {
  const connections = useNodeConnections({ handleType: type, handleId: id ?? undefined });
  const connected = connections.length > 0;
  const status = connected ? 'Connected' : 'Not connected';

  return (
    <Handle
      {...props}
      id={id}
      type={type}
      data-connected={connected ? 'true' : 'false'}
      aria-description={status}
      title={title ?? status}
      className={cn('transition-colors duration-200', connected ? '!bg-[#2a9d78] dark:!bg-[#62c9a1]' : '!bg-[#d65f70] dark:!bg-[#f08b96]', className)}
    />
  );
}
