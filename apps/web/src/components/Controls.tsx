import { CROP_MODES, type Format } from '@ips/sdk';
import {
  Crop,
  FileImage,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  ImageIcon,
  Link2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ERROR_SAMPLES, SAMPLES, type FormState, type Sample } from '@/lib/playground';

/** The form's id, so the Process button outside it can submit it. */
export const CONTROLS_FORM_ID = 'controls-form';

interface Props {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onSample: (sample: Sample) => void;
  onRun: () => void;
  /** The parameter the API rejected, to highlight its field. */
  errorParam: string | undefined;
  errorMessage: string | undefined;
}

const FORMATS: Array<{ value: Format | 'source'; label: string; hint?: string }> = [
  { value: 'source', label: 'Original format' },
  { value: 'auto', label: 'Auto', hint: 'best for this browser' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'gif', label: 'GIF' },
];

const CROP_HELP: Record<string, string> = {
  fill: 'Fills the box exactly, cropping what overflows.',
  fit: 'Fits inside the box and keeps the aspect ratio.',
  limit: 'Like fit, but never makes the image larger.',
  pad: 'Fits inside, then pads to the exact size.',
  scale: 'Stretches to the exact size.',
};

const LOSSLESS = new Set(['png', 'gif']);

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground [&>svg]:text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The monospace tag shows the matching API parameter. */
function Field(props: {
  id: string;
  label: string;
  param: string;
  hint?: ReactNode;
  error?: string | undefined;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={props.id}>{props.label}</Label>
        <div className="flex items-center gap-2">
          {props.aside}
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {props.param}
          </code>
        </div>
      </div>
      {props.children}
      {props.error ? (
        <p role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : (
        props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>
      )}
    </div>
  );
}

function SampleButtons({
  samples,
  onSample,
  tone,
}: {
  samples: Sample[];
  onSample: (s: Sample) => void;
  tone?: 'error';
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {samples.map((s) => (
        <Button
          key={s.url}
          type="button"
          size="xs"
          variant="outline"
          title={s.hint}
          className={
            tone === 'error'
              ? 'rounded-full text-muted-foreground hover:border-destructive/50 hover:text-destructive'
              : 'rounded-full text-muted-foreground'
          }
          onClick={() => onSample(s)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}

const normaliseAngle = (deg: number) => {
  const a = deg % 360;
  return a === 0 ? '' : String(a);
};

export function Controls({ form, onChange, onSample, onRun, errorParam, errorMessage }: Props) {
  const video = form.mode === 'video';
  const errorFor = (param: string) => (errorParam === param ? errorMessage : undefined);
  const invalid = (param: string) => errorParam === param || undefined;

  const flips = form.flip === 'both' ? ['horizontal', 'vertical'] : form.flip ? [form.flip] : [];
  const rotateBy = (delta: number) =>
    onChange({ rotate: normaliseAngle(Number(form.rotate || 0) + delta) });
  const blur = form.blur === '' ? 0 : Number(form.blur);

  return (
    <form
      id={CONTROLS_FORM_ID}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
      aria-label="Transformation options"
    >
      <Section title="What do you want to transform?" icon={<FileImage className="size-4" />}>
        <Tabs
          value={form.mode}
          onValueChange={(mode) => onChange({ mode: mode as FormState['mode'] })}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="image">
              <ImageIcon /> Image
            </TabsTrigger>
            <TabsTrigger value="video">
              <Film /> Video
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Field
          id="f-url"
          label={video ? 'Video URL' : 'Image URL'}
          param="url"
          error={errorFor('url')}
        >
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="f-url"
              type="url"
              inputMode="url"
              className="pl-8"
              placeholder={video ? 'https://example.com/clip.mp4' : 'https://example.com/photo.jpg'}
              value={form.url}
              onChange={(e) => onChange({ url: e.target.value })}
              aria-invalid={invalid('url')}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </Field>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Try a sample</p>
          <SampleButtons
            samples={SAMPLES.filter((s) => s.mode === form.mode)}
            onSample={onSample}
          />
          <p className="pt-1 text-xs text-muted-foreground">Or see how errors look</p>
          <SampleButtons samples={ERROR_SAMPLES} onSample={onSample} tone="error" />
        </div>

        {video && (
          <Field
            id="f-time"
            label="Frame at"
            param="time"
            hint="Seconds from the start; decimals allowed."
            error={errorFor('time')}
          >
            <div className="relative">
              <Input
                id="f-time"
                className="pr-10"
                type="number"
                min={0}
                step={0.1}
                placeholder="0"
                value={form.time}
                onChange={(e) => onChange({ time: e.target.value })}
                aria-invalid={invalid('time')}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                sec
              </span>
            </div>
          </Field>
        )}
      </Section>

      <Separator />

      <Section title="Size & fit" icon={<Crop className="size-4" />}>
        <div className="grid grid-cols-2 gap-3">
          {(['width', 'height'] as const).map((dim) => (
            <Field
              key={dim}
              id={`f-${dim}`}
              label={dim === 'width' ? 'Width' : 'Height'}
              param={dim}
              error={errorFor(dim)}
            >
              <div className="relative">
                <Input
                  id={`f-${dim}`}
                  className="pr-8"
                  type="number"
                  min={1}
                  placeholder="auto"
                  value={form[dim]}
                  onChange={(e) => onChange({ [dim]: e.target.value })}
                  aria-invalid={invalid(dim)}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                  px
                </span>
              </div>
            </Field>
          ))}
        </div>

        <Field
          id="f-crop"
          label="Fit"
          param="crop"
          hint={CROP_HELP[form.crop]}
          error={errorFor('crop')}
        >
          <ToggleGroup
            id="f-crop"
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            value={form.crop}
            onValueChange={(crop) => crop && onChange({ crop: crop as FormState['crop'] })}
            aria-label="Fit"
          >
            {CROP_MODES.map((c) => (
              <ToggleGroupItem
                key={c}
                value={c}
                className="flex-1 capitalize data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {c}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </Section>

      <Separator />

      <Section title="Format & quality" icon={<ImageIcon className="size-4" />}>
        <Field
          id="f-format"
          label="Format"
          param="format"
          hint={video && !form.format ? 'Video frames default to JPEG.' : undefined}
          error={errorFor('format')}
        >
          <Select
            value={form.format || 'source'}
            onValueChange={(v) => onChange({ format: v === 'source' ? '' : (v as Format) })}
          >
            <SelectTrigger id="f-format" className="w-full" aria-invalid={invalid('format')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.value === 'source' && video ? 'Default (JPEG)' : f.label}
                  {f.hint && <span className="text-muted-foreground">· {f.hint}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id="f-quality"
          label="Quality"
          param="quality"
          aside={<span className="text-sm font-medium tabular-nums">{form.quality}</span>}
          hint={
            LOSSLESS.has(form.format)
              ? `${form.format.toUpperCase()} is lossless, so quality has no effect.`
              : 'Lower means smaller files.'
          }
          error={errorFor('quality')}
        >
          <Slider
            id="f-quality"
            min={1}
            max={100}
            step={1}
            value={[form.quality]}
            onValueChange={([quality]) => onChange({ quality: quality! })}
            aria-label="Quality"
          />
        </Field>
      </Section>

      <Separator />

      <Section title="Adjustments" icon={<SlidersHorizontal className="size-4" />}>
        <Field id="f-rotate" label="Rotate" param="rotate" error={errorFor('rotate')}>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => rotateBy(-90)}
              aria-label="Rotate 90° counter-clockwise"
            >
              <RotateCcw />
            </Button>
            <div className="relative flex-1">
              <Input
                id="f-rotate"
                className="pr-10"
                type="number"
                min={-360}
                max={360}
                placeholder="0"
                value={form.rotate}
                onChange={(e) => onChange({ rotate: e.target.value })}
                aria-invalid={invalid('rotate')}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                deg
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => rotateBy(90)}
              aria-label="Rotate 90° clockwise"
            >
              <RotateCw />
            </Button>
          </div>
        </Field>

        <Field id="f-flip" label="Flip" param="flip" error={errorFor('flip')}>
          <ToggleGroup
            id="f-flip"
            type="multiple"
            variant="outline"
            size="sm"
            className="w-full"
            value={flips}
            onValueChange={(values) =>
              onChange({
                flip:
                  values.length === 2
                    ? 'both'
                    : ((values[0] as FormState['flip'] | undefined) ?? ''),
              })
            }
            aria-label="Flip"
          >
            <ToggleGroupItem
              value="horizontal"
              className="flex-1 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <FlipHorizontal2 /> Horizontal
            </ToggleGroupItem>
            <ToggleGroupItem
              value="vertical"
              className="flex-1 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <FlipVertical2 /> Vertical
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field
          id="f-blur"
          label="Blur"
          param="blur"
          aside={
            <span className="text-sm font-medium tabular-nums">{blur === 0 ? 'Off' : blur}</span>
          }
          error={errorFor('blur')}
        >
          <Slider
            id="f-blur"
            min={0}
            max={30}
            step={0.5}
            value={[blur]}
            // The API's minimum is 0.3, so the first step above "off" is 0.5.
            onValueChange={([value]) => onChange({ blur: value ? String(value) : '' })}
            aria-label="Blur"
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor="f-grayscale">Grayscale</Label>
            <p className="text-xs text-muted-foreground">Remove all colour</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              grayscale
            </code>
            <Switch
              id="f-grayscale"
              checked={form.grayscale}
              onCheckedChange={(grayscale) => onChange({ grayscale })}
            />
          </div>
        </div>
      </Section>
    </form>
  );
}
