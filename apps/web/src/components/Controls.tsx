import { CROP_MODES, FLIP_MODES, type Format } from '@ips/sdk';
import type { ReactNode } from 'react';
import { DEFAULT_QUALITY, ERROR_SAMPLES, SAMPLES, type FormState, type Sample } from '../lib.js';

interface Props {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onReset: () => void;
  onSample: (sample: Sample) => void;
  /** The parameter the API rejected, to highlight its field. */
  errorParam: string | undefined;
  errorMessage: string | undefined;
}

const FORMATS: Array<{ value: Format | ''; label: string }> = [
  { value: '', label: 'Keep source format' },
  { value: 'auto', label: 'auto (best for this browser)' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'gif', label: 'GIF' },
];

const CROP_HELP: Record<string, string> = {
  fill: 'Cover the box, cropping overflow',
  fit: 'Fit inside, keep aspect ratio',
  limit: 'Fit inside, never enlarge',
  pad: 'Fit inside, pad to exact size',
  scale: 'Stretch to exact size',
};

function Field(props: {
  name: string;
  label: string;
  hint?: string;
  errorParam: string | undefined;
  errorMessage: string | undefined;
  children: ReactNode;
}) {
  const invalid = props.errorParam === props.name;
  return (
    <div className={`field${invalid ? ' field--invalid' : ''}`}>
      <label htmlFor={`f-${props.name}`}>
        {props.label} <code>{props.name}</code>
      </label>
      {props.children}
      {invalid ? (
        <p className="field__error" role="alert">
          {props.errorMessage}
        </p>
      ) : (
        props.hint && <p className="field__hint">{props.hint}</p>
      )}
    </div>
  );
}

export function Controls({ form, onChange, onReset, onSample, errorParam, errorMessage }: Props) {
  const field = { errorParam, errorMessage };
  const video = form.mode === 'video';

  return (
    <form
      className="controls"
      onSubmit={(e) => e.preventDefault()}
      aria-label="Transformation options"
    >
      <fieldset className="mode" aria-label="Source type">
        {(['image', 'video'] as const).map((mode) => (
          <label
            key={mode}
            className={form.mode === mode ? 'mode__option mode__option--on' : 'mode__option'}
          >
            <input
              type="radio"
              name="mode"
              value={mode}
              checked={form.mode === mode}
              onChange={() => onChange({ mode })}
            />
            {mode === 'image' ? 'Image  /process' : 'Video  /video/thumbnail'}
          </label>
        ))}
      </fieldset>

      <Field name="url" label={video ? 'Video URL' : 'Image URL'} {...field}>
        <input
          id="f-url"
          type="url"
          inputMode="url"
          placeholder={video ? 'https://example.com/clip.mp4' : 'https://example.com/photo.jpg'}
          value={form.url}
          onChange={(e) => onChange({ url: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <div className="samples">
        <span className="samples__label">Samples</span>
        {SAMPLES.map((s) => (
          <button
            key={s.url}
            type="button"
            className="chip"
            title={s.hint}
            onClick={() => onSample(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="samples">
        <span className="samples__label">See an error</span>
        {ERROR_SAMPLES.map((s) => (
          <button
            key={s.url}
            type="button"
            className="chip chip--error"
            title={s.hint}
            onClick={() => onSample(s)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {video && (
        <Field name="time" label="Frame at (seconds)" hint="Decimals allowed, e.g. 2.5" {...field}>
          <input
            id="f-time"
            type="number"
            min={0}
            step={0.1}
            placeholder="0"
            value={form.time}
            onChange={(e) => onChange({ time: e.target.value })}
          />
        </Field>
      )}

      <div className="row">
        <Field name="width" label="Width" {...field}>
          <input
            id="f-width"
            type="number"
            min={1}
            placeholder="auto"
            value={form.width}
            onChange={(e) => onChange({ width: e.target.value })}
          />
        </Field>
        <Field name="height" label="Height" {...field}>
          <input
            id="f-height"
            type="number"
            min={1}
            placeholder="auto"
            value={form.height}
            onChange={(e) => onChange({ height: e.target.value })}
          />
        </Field>
      </div>

      <Field name="crop" label="Fit" hint={CROP_HELP[form.crop]} {...field}>
        <select
          id="f-crop"
          value={form.crop}
          onChange={(e) => onChange({ crop: e.target.value as FormState['crop'] })}
        >
          {CROP_MODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field
        name="format"
        label="Format"
        hint={video ? 'Thumbnails default to JPEG' : undefined}
        {...field}
      >
        <select
          id="f-format"
          value={form.format}
          onChange={(e) => onChange({ format: e.target.value as FormState['format'] })}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value === '' && video ? 'Default (JPEG)' : f.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        name="quality"
        label={`Quality: ${form.quality}`}
        hint="JPEG, WebP and AVIF only"
        {...field}
      >
        <input
          id="f-quality"
          type="range"
          min={1}
          max={100}
          value={form.quality}
          onChange={(e) => onChange({ quality: Number(e.target.value) })}
        />
      </Field>

      <div className="row">
        <Field name="rotate" label="Rotate°" {...field}>
          <input
            id="f-rotate"
            type="number"
            min={-360}
            max={360}
            step={90}
            placeholder="0"
            value={form.rotate}
            onChange={(e) => onChange({ rotate: e.target.value })}
          />
        </Field>
        <Field name="blur" label="Blur" {...field}>
          <input
            id="f-blur"
            type="number"
            min={0.3}
            max={100}
            step={0.5}
            placeholder="off"
            value={form.blur}
            onChange={(e) => onChange({ blur: e.target.value })}
          />
        </Field>
      </div>

      <div className="row">
        <Field name="flip" label="Flip" {...field}>
          <select
            id="f-flip"
            value={form.flip}
            onChange={(e) => onChange({ flip: e.target.value as FormState['flip'] })}
          >
            <option value="">none</option>
            {FLIP_MODES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field name="grayscale" label="Grayscale" {...field}>
          <label className="toggle">
            <input
              id="f-grayscale"
              type="checkbox"
              checked={form.grayscale}
              onChange={(e) => onChange({ grayscale: e.target.checked })}
            />
            {form.grayscale ? 'on' : 'off'}
          </label>
        </Field>
      </div>

      <button type="button" className="button button--ghost" onClick={onReset}>
        Reset transformations
      </button>
      <p className="field__hint">
        Quality defaults to {DEFAULT_QUALITY}. Fields left empty are not sent.
      </p>
    </form>
  );
}
