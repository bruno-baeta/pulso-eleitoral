/**
 * Território · municipal data from /api/municipal (server/municipal.ts), for the app's current source, state and round.
 * Wire format: c = [[number, total]] by total; m = [[ibge, name, uf, valid, [candIndex, votes, …]]] with pairs by votes.
 */
import type { Office } from '../../../shared/types';
import { fold as foldBase } from '../../domain/format';
import { MODE, TURN, UF, titleCase } from '../../raias/common';

export type Status = 'ready' | 'loading' | 'waiting' | 'paused' | 'unavailable';
export interface Payload {
  office: Office; area: string; status: Status; message: string;
  loaded: number; total: number; version: number; sourceAt: string | null;
  c: [string, number][]; m: [string, string, string, number, number[], string?][]; n: Record<string, [string, string]>;
}
export interface Unchanged { unchanged: true; status: Status; message: string; loaded: number; total: number; version: number }

export interface CityData { cdi: string; name: string; uf: string; f: string; vv: number; pairs: Int32Array; ht: string }
export interface OfficeData {
  office: Office; area: string; status: Status; message: string; loaded: number; total: number; version: number; sourceAt: string | null;
  nums: string[]; totals: number[]; names: Map<string, [string, string]>;
  cities: CityData[]; byCdi: Map<string, CityData>; wins: Map<number, number>;
}

/*
 * Busca de cidade tolera mais do que a busca de nome: "Sant'Ana do Livramento" e
 * "santana do livramento" têm de encontrar o mesmo município, então a pontuação também cai.
 */
export const fold = (s: string) => foldBase(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const munName = (nm: string) => titleCase(nm).replace(/ D'(\w)/g, (_, c) => ` d'${c.toUpperCase()}`);

export async function fetchMunicipal(office: Office, since?: number): Promise<Payload | Unchanged | null> {
  try {
    // 2022 is closed: the browser keeps it and asks only whether it changed (304), which is what
    // makes coming back to a state cheap — switching states reloads the page. Live sources move.
    const r = await fetch(`/api/municipal?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${office}${since === undefined ? '' : `&v=${since}`}`, { cache: MODE === 'historico' ? 'no-cache' : 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export function prepare(p: Payload): OfficeData {
  const cities = p.m.map(([cdi, nm, uf, vv, pairs, ht]) => { const name = munName(nm); return { cdi, name, uf, f: fold(name), vv, pairs: Int32Array.from(pairs), ht: ht || '' }; });
  const wins = new Map<number, number>();
  for (const c of cities) if (c.pairs.length) wins.set(c.pairs[0], (wins.get(c.pairs[0]) || 0) + 1);
  return {
    office: p.office, area: p.area, status: p.status, message: p.message, loaded: p.loaded, total: p.total, version: p.version, sourceAt: p.sourceAt,
    nums: p.c.map(c => c[0]), totals: p.c.map(c => c[1]), names: new Map(Object.entries(p.n)),
    cities, byCdi: new Map(cities.map(c => [c.cdi, c])), wins,
  };
}

/** Placeholder while nothing has arrived (or the office has no data for this selection). */
export function empty(office: Office, status: Status, message: string, loaded = 0, total = 0): OfficeData {
  return { office, area: office === 'president' ? 'BR' : UF, status, message, loaded, total, version: -1, sourceAt: null, nums: [], totals: [], names: new Map(), cities: [], byCdi: new Map(), wins: new Map() };
}
