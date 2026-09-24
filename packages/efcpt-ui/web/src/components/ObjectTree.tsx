import { useMemo, useState, type ReactNode } from 'react';
import {
  getEntries,
  isGenerated,
  refreshesObjectLists,
  sectionForType,
  setSelected,
  type ConfigEntry,
  type ConfigSection,
} from '../../../src/config/selection';
import type { EfcptConfig, EngineObject } from '../../../src/server/api';
import type { ObjectType } from '../../../src/engine/contract';

const typeTitles: Record<ObjectType, string> = {
  table: 'Tables',
  view: 'Views',
  storedProcedure: 'Stored procedures',
  function: 'Functions',
};

/** Groups with more objects than this start collapsed, to keep large databases responsive. */
const autoExpandLimit = 150;

interface Props {
  objects: EngineObject[];
  config: EfcptConfig;
  onChange(config: EfcptConfig): void;
}

function TriStateCheckbox(props: {
  checked: boolean;
  indeterminate: boolean;
  onChange(checked: boolean): void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={props.label}
      checked={props.checked}
      ref={(el) => {
        if (el) el.indeterminate = props.indeterminate;
      }}
      onChange={(e) => props.onChange(e.target.checked)}
    />
  );
}

function setMany(
  config: EfcptConfig,
  section: ConfigSection,
  names: string[],
  selected: boolean,
): EfcptConfig {
  const next = structuredClone(config);
  for (const name of names) setSelected(next, section, name, selected);
  return next;
}

function entryFor(config: EfcptConfig, section: ConfigSection, name: string): ConfigEntry | undefined {
  return getEntries(config, section).find((e) => e.name === name && !e.exclusionWildcard);
}

function toggleColumn(
  config: EfcptConfig,
  section: ConfigSection,
  name: string,
  column: string,
  excluded: boolean,
): EfcptConfig {
  const next = structuredClone(config);
  const entries = [...getEntries(next, section)];
  let entry = entries.find((e) => e.name === name && !e.exclusionWildcard);
  if (!entry) {
    // Only reachable for generated objects, where a plain { name } entry changes nothing
    entry = { name };
    entries.push(entry);
  }
  const columns = new Set((entry['excludedColumns'] as string[] | undefined) ?? []);
  if (excluded) columns.add(column);
  else columns.delete(column);
  if (columns.size) entry['excludedColumns'] = [...columns];
  else delete entry['excludedColumns'];
  (next as Record<string, unknown>)[section] = entries;
  return next;
}

function Wildcards(props: {
  config: EfcptConfig;
  section: ConfigSection;
  objects: EngineObject[];
  onChange(c: EfcptConfig): void;
}) {
  const { config, section } = props;
  const [draft, setDraft] = useState('');
  const wildcards = getEntries(config, section).filter((e) => e.exclusionWildcard);

  const update = (entries: ConfigEntry[]) => {
    const next = structuredClone(config);
    (next as Record<string, unknown>)[section] = entries;
    props.onChange(next);
  };
  const add = () => {
    const pattern = draft.trim();
    if (!pattern.includes('*')) return;
    update([{ exclusionWildcard: pattern }, ...getEntries(config, section)]);
    setDraft('');
  };

  return (
    <div className="wildcards">
      <span className="muted">Exclusion rules:</span>
      {wildcards.length === 0 && <span className="muted">none</span>}
      {wildcards.map((w) => (
        <span className="chip" key={w.exclusionWildcard}>
          <code>{w.exclusionWildcard}</code>
          <button
            className="link"
            aria-label={`Remove rule ${w.exclusionWildcard}`}
            onClick={() => update(getEntries(config, section).filter((e) => e !== w))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="small"
        placeholder="add, e.g. *Log or [audit].*"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        aria-label="New exclusion rule"
      />
      <button onClick={add} disabled={!draft.includes('*')}>
        Add rule
      </button>
    </div>
  );
}

function ObjectRow(props: {
  object: EngineObject;
  config: EfcptConfig;
  section: ConfigSection;
  onChange(c: EfcptConfig): void;
}) {
  const { object, config, section } = props;
  const [open, setOpen] = useState(false);
  const selected = isGenerated(config, section, object.displayName);
  const excluded = new Set(
    (entryFor(config, section, object.displayName)?.['excludedColumns'] as string[] | undefined) ?? [],
  );
  const hasColumns = (object.type === 'table' || object.type === 'view') && (object.columns?.length ?? 0) > 0;

  return (
    <li className="object">
      <div className="row">
        {hasColumns ? (
          <button
            className="twisty"
            aria-label={open ? 'Hide columns' : 'Show columns'}
            onClick={() => setOpen(!open)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <label>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => props.onChange(setMany(config, section, [object.displayName], e.target.checked))}
          />{' '}
          {object.name}
        </label>
        {excluded.size > 0 && <span className="muted"> ({excluded.size} columns excluded)</span>}
      </div>
      {open && hasColumns && (
        <ul className="columns">
          {object.columns!.map((column) => (
            <li key={column.name}>
              <label className={selected ? '' : 'muted'}>
                <input
                  type="checkbox"
                  disabled={!selected || column.isPrimaryKey}
                  checked={selected && !excluded.has(column.name)}
                  onChange={(e) =>
                    props.onChange(
                      toggleColumn(config, section, object.displayName, column.name, !e.target.checked),
                    )
                  }
                />{' '}
                {column.name} <span className="muted">{column.storeType}</span>
                {column.isPrimaryKey && <span className="badge">key</span>}
                {column.isForeignKey && <span className="badge">FK</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Group(props: {
  title: string;
  names: string[];
  config: EfcptConfig;
  section: ConfigSection;
  onChange(c: EfcptConfig): void;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen);
  const selectedCount = props.names.filter((n) => isGenerated(props.config, props.section, n)).length;
  return (
    <li className="group">
      <div className="row">
        <button
          className="twisty"
          aria-label={open ? `Collapse ${props.title}` : `Expand ${props.title}`}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <label>
          <TriStateCheckbox
            label={`Select all in ${props.title}`}
            checked={selectedCount > 0 && selectedCount === props.names.length}
            indeterminate={selectedCount > 0 && selectedCount < props.names.length}
            onChange={(checked) => props.onChange(setMany(props.config, props.section, props.names, checked))}
          />{' '}
          <strong>{props.title}</strong>
        </label>
        <span className="muted">
          {' '}
          {selectedCount} of {props.names.length}
        </span>
      </div>
      {open && <ul>{props.children}</ul>}
    </li>
  );
}

export function ObjectTree({ objects, config, onChange }: Props) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? objects.filter((o) => o.displayName.toLowerCase().includes(query)) : objects),
    [objects, query],
  );

  const total = objects.length;
  const selectedTotal = objects.filter((o) =>
    isGenerated(config, sectionForType[o.type], o.displayName),
  ).length;
  const allVisible = (selected: boolean) => {
    let next = config;
    for (const type of Object.keys(sectionForType) as ObjectType[]) {
      const names = visible.filter((o) => o.type === type).map((o) => o.displayName);
      if (names.length) next = setMany(next, sectionForType[type], names, selected);
    }
    onChange(next);
  };

  return (
    <div className="objects">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter objects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter objects"
        />
        <button onClick={() => allVisible(true)}>Select {query ? 'shown' : 'all'}</button>
        <button onClick={() => allVisible(false)}>Select none{query ? ' shown' : ''}</button>
        <span className="muted">
          {selectedTotal} of {total} selected
        </span>
      </div>
      {refreshesObjectLists(config) && (
        <p className="hint">
          New database objects are added and generated automatically (<code>refresh-object-lists</code> is
          on). Untick them to leave them out.
        </p>
      )}
      <ul className="tree">
        {(Object.keys(sectionForType) as ObjectType[]).map((type) => {
          const section = sectionForType[type];
          const ofType = visible.filter((o) => o.type === type);
          if (ofType.length === 0 && !objects.some((o) => o.type === type)) return null;
          const schemas = [...new Set(ofType.map((o) => o.schema ?? ''))].sort();
          return (
            <li key={type} className="type">
              <Group
                title={typeTitles[type]}
                names={ofType.map((o) => o.displayName)}
                config={config}
                section={section}
                onChange={onChange}
                defaultOpen
              >
                <li>
                  <Wildcards config={config} section={section} objects={objects} onChange={onChange} />
                </li>
                {schemas.map((schema) => {
                  const inSchema = ofType.filter((o) => (o.schema ?? '') === schema);
                  const rows = inSchema.map((o) => (
                    <ObjectRow
                      key={o.displayName}
                      object={o}
                      config={config}
                      section={section}
                      onChange={onChange}
                    />
                  ));
                  return schema ? (
                    <Group
                      key={schema}
                      title={schema}
                      names={inSchema.map((o) => o.displayName)}
                      config={config}
                      section={section}
                      onChange={onChange}
                      defaultOpen={Boolean(query) || inSchema.length <= autoExpandLimit}
                    >
                      {rows}
                    </Group>
                  ) : (
                    rows
                  );
                })}
              </Group>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
