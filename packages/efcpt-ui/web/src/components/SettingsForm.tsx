import type { EfcptConfig } from '../../../src/server/api';
import {
  disabledReason,
  effectiveValue,
  getValue,
  sections,
  setValue,
  type Field,
  type SectionKey,
} from '../settings';

interface Props {
  config: EfcptConfig;
  isDacpac: boolean;
  onChange(config: EfcptConfig): void;
}

function FieldInput(props: {
  field: Field;
  section: SectionKey;
  config: EfcptConfig;
  disabled?: string;
  onChange(c: EfcptConfig): void;
}) {
  const { field, section, config } = props;
  const id = `${section}.${field.key}`;
  const value = effectiveValue(config, section, field);
  const explicit = getValue(config, section, field.key) !== undefined;
  const set = (v: unknown) => props.onChange(setValue(config, section, field.key, v));
  const reset = explicit ? (
    <button
      className="link small"
      onClick={() => set(undefined)}
      title="Remove from the config and use the engine default"
    >
      default
    </button>
  ) : null;

  switch (field.kind) {
    case 'boolean':
      return (
        <div className="field checkbox" title={props.disabled}>
          <label htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              disabled={Boolean(props.disabled) && value !== true}
              onChange={(e) => set(e.target.checked)}
            />{' '}
            {field.title}
          </label>
          {reset}
          {props.disabled && <span className="muted small"> {props.disabled}</span>}
        </div>
      );
    case 'enum':
      return (
        <div className="field">
          <label htmlFor={id}>{field.title}</label>
          <select id={id} value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
            {field.options!.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {reset}
        </div>
      );
    case 'text':
    case 'nullable-text':
      return (
        <div className="field">
          <label htmlFor={id}>{field.title}</label>
          <input
            id={id}
            type="text"
            value={typeof value === 'string' ? value : ''}
            placeholder={field.kind === 'nullable-text' ? '(default)' : ''}
            disabled={Boolean(props.disabled)}
            onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}
          />
          {props.disabled && <span className="muted small">{props.disabled}</span>}
        </div>
      );
    case 'string-list': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="field">
          <label htmlFor={id}>{field.title}</label>
          <textarea
            id={id}
            rows={3}
            placeholder="One word per line"
            value={list.join('\n')}
            onChange={(e) => {
              const words = e.target.value.split('\n').map((w) => w.trim());
              set(words.some(Boolean) ? words : undefined);
            }}
            onBlur={(e) => {
              const words = e.target.value
                .split('\n')
                .map((w) => w.trim())
                .filter(Boolean);
              set(words.length ? words : undefined);
            }}
          />
        </div>
      );
    }
    default: {
      const current = getValue(config, section, field.key);
      const count = Array.isArray(current) ? current.length : 0;
      return (
        <div className="field">
          <span>{field.title}</span>
          <span className="muted small">
            {count ? `${count} entries. ` : ''}Edit this one in the config file.
          </span>
        </div>
      );
    }
  }
}

export function SettingsForm({ config, isDacpac, onChange }: Props) {
  return (
    <div className="settings">
      <p className="hint">
        Options you don&apos;t change stay out of the config file and use the engine&apos;s defaults.
        &ldquo;default&rdquo; removes an option again.
      </p>
      {sections.map((section) => (
        <fieldset key={section.key}>
          <legend>{section.title}</legend>
          {section.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              section={section.key}
              config={config}
              disabled={disabledReason(config, section.key, field.key, isDacpac)}
              onChange={onChange}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
