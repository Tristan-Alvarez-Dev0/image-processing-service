import { Loader2, Play, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CONTROLS_FORM_ID } from '@/components/Controls';
import type { Mode } from '@/lib/playground';

interface Props {
  mode: Mode;
  disabled: boolean;
  running: boolean;
  dirty: boolean;
  onReset: () => void;
}

export function RunBar({ mode, disabled, running, dirty, onReset }: Props) {
  const label = mode === 'video' ? 'Get thumbnail' : 'Process image';

  return (
    <div className="w-full space-y-2">
      {dirty && !running && (
        <p className="flex items-center gap-1.5 text-xs text-amber-400" role="status">
          <span className="size-1.5 rounded-full bg-amber-400" />
          You have changes that haven't been applied.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="text-muted-foreground"
          onClick={onReset}
          aria-label="Reset adjustments"
          title="Reset adjustments"
        >
          <Undo2 />
        </Button>
        <Button
          type="submit"
          form={CONTROLS_FORM_ID}
          size="lg"
          className="flex-1"
          disabled={disabled || running}
        >
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {running ? 'Processing…' : label}
        </Button>
      </div>
      {disabled && (
        <p className="text-center text-xs text-muted-foreground">
          Add a URL or pick a sample to get started.
        </p>
      )}
    </div>
  );
}
