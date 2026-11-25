import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import type { LivePatient } from '../../engine';
import { C } from '../visual';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; size?: 'sm' | 'md' | 'lg' };

export function Btn({ variant = 'ghost', size = 'md', className = '', ...rest }: BtnProps) {
  const v = {
    primary: 'bg-ink text-paper border-ink hover:bg-ink/85',
    ghost: 'border-ink hover:bg-ink hover:text-paper',
    danger: 'border-c-red text-c-red hover:bg-c-red hover:text-white',
    quiet: 'border-rule hover:border-ink',
  }[variant];
  const s = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-14 px-6 text-base' }[size];
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${v} ${s} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-ink bg-paper ${className}`}>{children}</div>;
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="font-pixel text-[10px] uppercase tracking-wider text-mute">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-11 w-full border border-ink bg-paper px-3 text-sm outline-none focus:bg-white';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export const STATUS: Record<string, { label: string; color: string; text: string }> = {
  BOOKED: { label: 'At home', color: C.navy, text: '#fff' },
  LEAVE_NOW: { label: 'Leave now', color: C.blue, text: '#fff' },
  EN_ROUTE: { label: 'On the way', color: C.orange, text: '#111' },
  WAITING: { label: 'Waiting', color: C.red, text: '#fff' },
  IN_CONSULT: { label: 'With doctor', color: C.green, text: '#fff' },
  DONE: { label: 'Done', color: '#d9d8d3', text: '#444' },
  CANCELLED: { label: 'Cancelled', color: '#bbb', text: '#333' },
  NO_SHOW: { label: 'No-show', color: '#8a1c1c', text: '#fff' },
  EMERGENCY: { label: 'Emergency', color: C.pink, text: '#fff' },
};

export function statusKey(p: LivePatient): string {
  if (p.kind === 'EMERGENCY' && p.status === 'WAITING') return 'EMERGENCY';
  if (p.status === 'BOOKED' && p.leaveNowAt !== null) return 'LEAVE_NOW';
  return p.status;
}

export function StatusBadge({ p }: { p: LivePatient }) {
  const st = STATUS[statusKey(p)];
  return (
    <span className="inline-block whitespace-nowrap px-2 py-0.5 text-[11px] font-medium" style={{ background: st.color, color: st.text }}>
      {st.label}
    </span>
  );
}

export function Token({ n, big }: { n: number; big?: boolean }) {
  return <span className={`font-pixel tabular-nums ${big ? 'text-5xl' : 'text-base'}`}>{String(n).padStart(2, '0')}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-rule px-4 py-8 text-center text-sm text-mute">{children}</div>;
}

export function download(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
