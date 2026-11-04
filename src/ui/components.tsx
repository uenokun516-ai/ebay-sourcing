import type { ComponentChildren } from 'preact';
import type { Num } from '../core/money';
import type { Verdict } from '../core/types';
import { VERDICT_LABELS } from '../core/types';
import { isoToDateInput, dateInputToIso } from './store';

export function Header({ title, back, right }: { title: string; back?: string; right?: ComponentChildren }) {
  return (
    <header class="hdr">
      {back !== undefined ? <a class="back" href={'#/' + back} aria-label="戻る">‹</a> : <span class="back-sp" />}
      <h1>{title}</h1>
      <div class="hdr-r">{right}</div>
    </header>
  );
}

export function Card({ title, children, right }: { title?: ComponentChildren; children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <section class="card">
      {title && <div class="card-h"><h2>{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

export function Text({ label, value, onInput, multiline, placeholder, type = 'text' }: {
  label: string; value: string; onInput: (v: string) => void; multiline?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <label class="fld">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} rows={3} />
      ) : (
        <input type={type as any} value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      )}
    </label>
  );
}

/** 数値欄：空欄=未入力(null)。0 はボタンで明示的に確定する。 */
export function NumField({ label, value, onChange, unit, big, hint }: {
  label: string; value: Num; onChange: (v: Num) => void; unit?: string; big?: boolean; hint?: string;
}) {
  const unset = value === null || value === undefined || value === '';
  return (
    <label class={'fld num' + (big ? ' big' : '') + (unset ? ' unset' : '')}>
      <span>{label}{unset && <em class="tag-unset">未入力</em>}</span>
      <div class="num-row">
        <input
          inputMode="decimal"
          value={value ?? ''}
          placeholder="未入力"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d.\-]/g, '');
            onChange(v === '' ? null : v);
          }}
        />
        {unit && <span class="unit">{unit}</span>}
        {unset ? (
          <button type="button" class="mini" onClick={() => onChange('0')} title="0円で確定">0で確定</button>
        ) : (
          <button type="button" class="mini ghost" onClick={() => onChange(null)} title="未入力に戻す">×</button>
        )}
      </div>
      {hint && <small class="hint">{hint}</small>}
    </label>
  );
}

export function Select<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: [T, string][];
}) {
  return (
    <label class="fld">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
        {options.map(([v, l]) => <option value={v} key={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <label class="fld">
      <span>{label}</span>
      <input type="date" value={isoToDateInput(value)} onInput={(e) => onChange(dateInputToIso((e.target as HTMLInputElement).value))} />
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

export function VerdictBadge({ v }: { v: Verdict }) {
  const icon = { undetermined: '？', pass: '✕', conditional: '△', candidate: '○' }[v];
  return <span class={'verdict v-' + v}>{icon} {VERDICT_LABELS[v]}</span>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

export function Warn({ children }: { children: ComponentChildren }) {
  return <div class="warn">{children}</div>;
}

export function ExtLink({ url }: { url: string }) {
  if (!url) return null;
  let safe = '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') safe = u.href;
  } catch { /* noop */ }
  if (!safe) return <span class="muted">{url}</span>;
  return <a href={safe} target="_blank" rel="noopener noreferrer" class="ext">{new URL(safe).hostname} ↗</a>;
}

export function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
