import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Candidate, Office, Party, Race, Turn } from '../shared/types.ts';

/** [id, votes, percent, elected, status] */
type Row = [string, number, number, 0 | 1, string];
type RaceFields = Omit<Race, 'candidates' | 'parties' | 'history'>;
interface Frame { at: number; race: RaceFields; rows: Row[] }
interface Track { names: Map<string, Pick<Candidate, 'id' | 'name' | 'number' | 'party' | 'color'>>; frames: Frame[]; lastAt: number }

/** Legislative races keep the head of the list; the tail does not move the tracks. */
const ROWS = 400;
/** At most one frame per race every few seconds: enough to replay, small enough to keep hours on disk. */
const MIN_GAP = 4000;

/**
 * Append-only recording of every accepted result, one NDJSON file per race and session.
 * A replay rebuilds the race as it was at any instant from the last frame before it.
 */
export class Recorder {
  private tracks = new Map<string, Promise<Track>>();

  constructor(private dir = './data/recordings') {}

  private path(key: string) { return `${this.dir}/${key}.ndjson`; }

  static key(mode: string, session: string, turn: Turn, area: string, office: Office) {
    return `${mode}/${session}/t${turn}/${area.toLowerCase()}-${office}`;
  }

  private track(key: string): Promise<Track> {
    let track = this.tracks.get(key);
    if (!track) {
      track = readFile(this.path(key), 'utf8').then(text => parse(text), () => ({ names: new Map(), frames: [], lastAt: 0 }));
      this.tracks.set(key, track);
    }
    return track;
  }

  async record(key: string, race: Race, at = race.receivedAt) {
    const track = await this.track(key);
    const last = track.frames.at(-1);
    if (last && (at - track.lastAt < MIN_GAP && race.status !== 'finished')) return;
    if (last && at <= last.at) return;
    const rows: Row[] = race.candidates.slice(0, ROWS).map(c => [c.id, c.votes, c.percent, c.elected ? 1 : 0, c.status]);
    const unknown = race.candidates.slice(0, ROWS).filter(c => !track.names.has(c.id)).map(c => ({ id: c.id, name: c.name, number: c.number, party: c.party, color: c.color }));
    const { candidates: _c, parties: _p, history: _h, ...fields } = race;
    const frame: Frame = { at, race: fields, rows };
    let lines = '';
    if (unknown.length) { for (const n of unknown) track.names.set(n.id, n); lines += JSON.stringify({ m: unknown }) + '\n'; }
    lines += JSON.stringify({ f: frame }) + '\n';
    track.frames.push(frame); track.lastAt = at;
    await mkdir(dirname(this.path(key)), { recursive: true });
    await appendFile(this.path(key), lines);
  }

  /** First and last instants recorded for these races, or null when nothing was recorded. */
  async span(keys: string[]): Promise<{ start: number; end: number } | null> {
    const tracks = (await Promise.all(keys.map(k => this.track(k)))).filter(t => t.frames.length);
    if (!tracks.length) return null;
    return { start: Math.min(...tracks.map(t => t.frames[0].at)), end: Math.max(...tracks.map(t => t.frames.at(-1)!.at)) };
  }

  /**
   * Time series for the charts: one point per recorded frame with the counted percentage and, for
   * each candidate, the votes counted so far and their share of the valid ones. Candidates are the
   * ones that ever appear in the recording.
   */
  async series(key: string, limit = 600): Promise<{ candidates: { id: string; name: string; party: string; color: string }[]; points: { at: number; counted: number; votes: number[]; shares: number[] }[] } | null> {
    const track = await this.track(key);
    if (!track.frames.length) return null;
    const ids: string[] = [];
    const last = track.frames.at(-1)!;
    for (const [id] of last.rows) ids.push(id);
    const index = new Map(ids.map((id, i) => [id, i]));
    const stride = Math.max(1, Math.ceil(track.frames.length / limit));
    const points = track.frames.filter((_, i) => i % stride === 0 || i === track.frames.length - 1).map(f => {
      const shares = new Array<number>(ids.length).fill(0);
      const votes = new Array<number>(ids.length).fill(0);
      for (const [id, tally, percent] of f.rows) {
        const i = index.get(id);
        if (i !== undefined) { shares[i] = percent; votes[i] = tally; }
      }
      return { at: f.at, counted: f.race.countedPercent, votes, shares };
    });
    const candidates = ids.map(id => {
      const n = track.names.get(id);
      return { id, name: n?.name ?? id, party: n?.party ?? '', color: n?.color ?? '#8a94a6' };
    });
    return { candidates, points };
  }

  /** The race as it stood at `at`. Before the first frame it is the same race with nothing counted. */
  async raceAt(key: string, at: number): Promise<Race | null> {
    const track = await this.track(key);
    if (!track.frames.length) return null;
    let lo = 0, hi = track.frames.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (track.frames[mid].at <= at) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    const frame = track.frames[Math.max(0, found)];
    return found < 0 ? zeroRace(build(track, frame)) : build(track, frame);
  }
}

function parse(text: string): Track {
  const track: Track = { names: new Map(), frames: [], lastAt: 0 };
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.m) for (const n of entry.m) track.names.set(n.id, n);
      else if (entry.f) track.frames.push(entry.f);
    } catch { /* A torn last line after a crash is skipped. */ }
  }
  track.frames.sort((a, b) => a.at - b.at);
  track.lastAt = track.frames.at(-1)?.at ?? 0;
  return track;
}

function build(track: Track, frame: Frame): Race {
  const candidates: Candidate[] = frame.rows.map(([id, votes, percent, elected, status]) => {
    const n = track.names.get(id) ?? { id, name: id, number: '', party: '', color: '#8a94a6' };
    return { ...n, votes, percent, elected: elected === 1, status };
  });
  return { ...frame.race, candidates, parties: partiesOf(candidates), history: [] };
}

function zeroRace(race: Race): Race {
  const candidates = race.candidates.map(c => ({ ...c, votes: 0, percent: 0, elected: false, status: '' }));
  return {
    ...race, status: 'partial', totalizedAt: null, countedPercent: 0, countedSections: 0, validVotes: 0, totalVotes: 0,
    blankVotes: 0, nullVotes: 0, turnout: 0, abstention: 0, abstentionPercent: 0, candidates, parties: partiesOf(candidates),
  };
}

function partiesOf(candidates: Candidate[]): Party[] {
  const map = new Map<string, Party>();
  for (const c of candidates) {
    const p = map.get(c.party) ?? { name: c.party, votes: 0, elected: 0, color: c.color };
    p.votes += c.votes; if (c.elected) p.elected++;
    map.set(c.party, p);
  }
  return [...map.values()].sort((a, b) => b.votes - a.votes);
}
