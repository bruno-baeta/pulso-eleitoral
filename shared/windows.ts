/**
 * Time windows published by the TSE. Brasília has no daylight saving time, so -03:00 is fixed.
 * The simulation environment only serves files inside these windows, and requesting files
 * outside them yields 404s, which the TSE may answer by blocking the IP.
 */
export interface TimeWindow { start: number; end: number; turn: 1 | 2 }

const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`);

export const SIMULADO_WINDOWS: TimeWindow[] = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-22', '2026-09-23', '2026-09-24']
  .flatMap(day => [[9, 12], [14, 17]].map(([a, b]) => ({ start: at(day, a), end: at(day, b), turn: 1 as const })));

/** Election nights: counting starts at 17h; collection runs from 16h until noon the next day. */
export const OFFICIAL_WINDOWS: TimeWindow[] = [
  { start: at('2026-10-04', 16), end: at('2026-10-05', 12), turn: 1 },
  { start: at('2026-10-25', 16), end: at('2026-10-26', 12), turn: 2 },
];

export const openWindow = (windows: TimeWindow[], now = Date.now()) => windows.find(w => now >= w.start && now < w.end) ?? null;
export const nextWindow = (windows: TimeWindow[], now = Date.now()) => windows.find(w => w.start > now) ?? null;
/** The window a recording belongs to: the open one, or the latest one already started. */
export const sessionWindow = (windows: TimeWindow[], now = Date.now()) => [...windows].reverse().find(w => w.start <= now) ?? null;

export function describeWindow(w: TimeWindow): string {
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts });
  return `${fmt(w.start, { weekday: 'short', day: '2-digit', month: '2-digit' })}, das ${fmt(w.start, { hour: '2-digit', minute: '2-digit' })} às ${fmt(w.end, { hour: '2-digit', minute: '2-digit' })}`;
}
