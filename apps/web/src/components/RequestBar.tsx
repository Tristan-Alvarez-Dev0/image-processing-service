import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { curlCommand } from '@/lib/playground';

interface Props {
  path: string | undefined;
  negotiated: boolean;
}

function CopyButton({ text, label, icon }: { text: string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="text-emerald-400" /> : icon}
      {copied ? 'Copied!' : label}
    </Button>
  );
}

export function RequestBar({ path, negotiated }: Props) {
  if (!path) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-sm text-muted-foreground">
          The exact API request will appear here, ready to copy.
        </CardContent>
      </Card>
    );
  }
  const url = new URL(path, window.location.origin).href;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Badge className="mt-0.5 bg-emerald-500/15 font-mono text-emerald-400">GET</Badge>
          <code
            data-testid="request-url"
            className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed break-all"
          >
            {url}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={url} label="Copy URL" icon={<Copy />} />
          <CopyButton
            text={curlCommand(url, negotiated)}
            label="Copy as curl"
            icon={<Terminal />}
          />
          <Button asChild variant="ghost" size="sm">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
          {negotiated && (
            <span className="text-xs text-muted-foreground">
              format=auto depends on the Accept header, so the curl command sends one.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
