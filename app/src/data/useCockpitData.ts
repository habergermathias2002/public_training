import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Activity,
  BestwertItem,
  CalendarPlanItem,
  DailyMetric,
  DriftPoint,
  EffizienzPoint,
  EinheitDetail,
  EventItem,
  FeedbackRow,
  FtpBuilderItem,
  KPI,
  LandItem,
  MarkerItem,
  RadEffPoint,
  TrainerItem,
  TrainingsplanPayload,
  TrendItem,
  Vo2MaxPoint,
  WeeklySummary,
} from '../types';
import { TODAY_ISO } from '../utils/format';

const lokal = import.meta.glob('../../../auswertung/*.json', { import: 'default' });
const supa =
  typeof __SUPABASE_URL__ !== 'undefined' &&
  typeof __SUPABASE_ANON_KEY__ !== 'undefined' &&
  __SUPABASE_URL__ &&
  __SUPABASE_ANON_KEY__ &&
  !__SUPABASE_URL__.includes('your-project-id')
    ? createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__)
    : null;

const NUR_LOKAL = new Set(['karte']);

const ALL_SOURCES = [
  'aktivitaeten',
  'einheiten',
  'tage',
  'wochen',
  'kalender',
  'kpis',
  'trends',
  'trainer',
  'events',
  'marker',
  'ftp_builder',
  'fortschritt',
  'effizienz',
  'drift',
  'bestwerte',
  'vo2max',
  'rad_effizienz',
  'laender',
  'trainingsplan',
  'feedback',
  'karte',
] as const;

type SourceName = (typeof ALL_SOURCES)[number];

async function loadFromLocal(id: string): Promise<{ rows: any[]; meta: any[] }> {
  const loader = lokal[`../../../auswertung/${id}.json`];
  if (!loader) return { rows: [], meta: [] };
  const j: any = await loader();
  return {
    rows: Array.isArray(j) ? j : j.rows ?? [],
    meta: Array.isArray(j) ? [] : j.meta ?? [],
  };
}

async function loadDataset(id: string): Promise<{ rows: any[]; meta: any[]; origin: 'Supabase' | 'lokal' }> {
  if (supa && !NUR_LOKAL.has(id)) {
    try {
      const { data, error } = await supa
        .from('datasets')
        .select('part, rows, meta')
        .eq('name', id)
        .order('part');
      if (!error && data && data.length > 0) {
        return {
          rows: data.flatMap((p: any) => p.rows ?? []),
          meta: data[0].meta ?? [],
          origin: 'Supabase',
        };
      }
    } catch (e) {
      console.warn(`Supabase fallback for ${id}:`, e);
    }
  }
  const res = await loadFromLocal(id);
  return { ...res, origin: 'lokal' };
}

export interface CockpitDataStore {
  loading: boolean;
  sourceBadge: string;
  stand: string;
  aktivitaeten: Activity[];
  einheitenById: Map<string, EinheitDetail>;
  tage: DailyMetric[];
  wochen: WeeklySummary[];
  kalender: CalendarPlanItem[];
  kpis: KPI[];
  fortschrittKpis: KPI[];
  trends: TrendItem[];
  trainer: TrainerItem[];
  events: EventItem[];
  marker: MarkerItem[];
  ftpBuilder: FtpBuilderItem[];
  effizienz: EffizienzPoint[];
  drift: DriftPoint[];
  bestwerte: BestwertItem[];
  vo2max: Vo2MaxPoint[];
  radEffizienz: RadEffPoint[];
  laender: LandItem[];
  karte: any[];
  trainingsplan: TrainingsplanPayload | null;
  feedback: FeedbackRow[];
  tagesformByDate: Map<string, FeedbackRow>;
  rpeByActivity: Map<string, FeedbackRow>;
  saveTagesform: (input: {
    datum: string;
    beine: number;
    stress: number;
    schlaf_qualitaet: number;
    notiz: string;
  }) => Promise<{ ok: boolean; msg: string }>;
  saveRpe: (input: {
    activity_id: string;
    datum: string;
    titel: string;
    rpe: number;
    gefuehl: string;
    notiz: string;
  }) => Promise<{ ok: boolean; msg: string }>;
  recalcAndSync: () => Promise<boolean>;
}

const LOCAL_FB_KEY = 'ic_feedback_v1';

export function useCockpitData(): CockpitDataStore {
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState<Record<string, { rows: any[]; meta: any[]; origin: 'Supabase' | 'lokal' }>>({});
  const [extraFeedback, setExtraFeedback] = useState<FeedbackRow[]>(() => {
    try {
      const s = localStorage.getItem(LOCAL_FB_KEY);
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });

  const fetchAll = useCallback(async () => {
    const entries = await Promise.all(
      ALL_SOURCES.map(async (name) => {
        try {
          const res = await loadDataset(name);
          return [name, res] as const;
        } catch (err) {
          console.error(`Error loading ${name}:`, err);
          return [name, { rows: [] as any[], meta: [] as any[], origin: 'lokal' as 'Supabase' | 'lokal' }] as const;
        }
      })
    );
    const map: Record<string, { rows: any[]; meta: any[]; origin: 'Supabase' | 'lokal' }> = {};
    for (const [k, v] of entries) {
      map[k] = v;
    }
    // Also fetch latest from local Vite /api/feedback if running dev server
    try {
      const r = await fetch('/api/feedback');
      if (r.ok) {
        const j = await r.json();
        if (j.ok && Array.isArray(j.rows) && j.rows.length > 0) {
          map.feedback = {
            rows: j.rows,
            meta: map.feedback?.meta || [],
            origin: map.feedback?.origin || 'lokal',
          };
        }
      }
    } catch {
      // Static build without dev middleware
    }
    setRaw(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const feedback = useMemo<FeedbackRow[]>(() => {
    const base: FeedbackRow[] = raw.feedback?.rows || [];
    const byId = new Map<string, FeedbackRow>();
    for (const r of base) byId.set(r.id, r);
    for (const r of extraFeedback) byId.set(r.id, r);
    return [...byId.values()];
  }, [raw.feedback, extraFeedback]);

  const tagesformByDate = useMemo(() => {
    const m = new Map<string, FeedbackRow>();
    for (const r of feedback) {
      if (r.typ === 'tagesform' && r.datum) m.set(r.datum, r);
    }
    return m;
  }, [feedback]);

  const rpeByActivity = useMemo(() => {
    const m = new Map<string, FeedbackRow>();
    for (const r of feedback) {
      if (r.typ === 'rpe' && r.activity_id) m.set(String(r.activity_id), r);
    }
    return m;
  }, [feedback]);

  const einheitenById = useMemo(() => {
    const m = new Map<string, EinheitDetail>();
    for (const e of (raw.einheiten?.rows || []) as EinheitDetail[]) {
      const rpeItem = rpeByActivity.get(String(e.id));
      if (rpeItem) {
        m.set(String(e.id), {
          ...e,
          rpe: rpeItem.rpe,
          rpe_gefuehl: rpeItem.gefuehl,
          rpe_notiz: rpeItem.notiz,
        });
      } else {
        m.set(String(e.id), e);
      }
    }
    return m;
  }, [raw.einheiten, rpeByActivity]);

  const tage = useMemo<DailyMetric[]>(() => raw.tage?.rows || [], [raw.tage]);

  // Live recalculation of Tagesform KPI when subjective check-in changes
  const kpis = useMemo<KPI[]>(() => {
    const base: KPI[] = (raw.kpis?.rows || []).map((k: KPI) => ({ ...k }));
    const tf = tagesformByDate.get(TODAY_ISO) || [...tagesformByDate.values()].slice(-1)[0];
    const tfKpi = base.find((k) => k.id === 'tagesform');
    if (tfKpi && tf) {
      const t0 = tage[tage.length - 1];
      const rpSlice = tage.slice(-8, -1).filter((t) => t.ruhepuls != null);
      const basis = rpSlice.length ? rpSlice.reduce((s, t) => s + (t.ruhepuls || 0), 0) / rpSlice.length : null;
      const rpHeute = t0?.ruhepuls ?? null;
      const schlaf = t0?.schlaf_h ?? (tage.length > 1 ? tage[tage.length - 2].schlaf_h : null);
      const abw = rpHeute != null && basis != null ? rpHeute - basis : null;
      const subjWarn = (tf.beine != null && tf.beine <= 2 ? 1 : 0) + (tf.stress != null && tf.stress >= 4 ? 1 : 0);
      const daneben = (abw != null && abw > 3 ? 1 : 0) + (schlaf != null && schlaf < 7 ? 1 : 0) + (subjWarn >= 1 ? 1 : 0);
      const ampel =
        (abw != null && abw >= 7) || daneben >= 2 || subjWarn >= 2
          ? 'rot'
          : daneben === 1
          ? 'gelb'
          : 'grün';
      tfKpi.wert_text = ampel;
      tfKpi.bewertung = ampel === 'grün' ? 'gut' : ampel === 'gelb' ? 'warn' : 'schlecht';
      tfKpi.vergleich = `Ruhepuls ${rpHeute ?? '–'} (7T-Ø ${basis ? basis.toFixed(1).replace('.', ',') : '–'}), Schlaf ${
        schlaf != null ? String(schlaf).replace('.', ',') : '–'
      } h · Beine ${tf.beine ?? '–'}/5, Stress ${tf.stress ?? '–'}/5`;
    }
    return base;
  }, [raw.kpis, tagesformByDate, tage]);

  const trainingsplan = useMemo<TrainingsplanPayload | null>(() => {
    const rows = raw.trainingsplan?.rows || [];
    if (!rows.length || !rows[0]?.payload) return null;
    try {
      return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    } catch {
      return null;
    }
  }, [raw.trainingsplan]);

  const stand = useMemo(() => {
    const meta = raw.kpis?.meta || [];
    const m = meta.find((x: any) => x.label === 'Stand');
    return m ? m.value : TODAY_ISO;
  }, [raw.kpis]);

  const sourceBadge = useMemo(() => {
    const origins = Object.entries(raw)
      .filter(([k]) => !NUR_LOKAL.has(k))
      .map(([, v]) => v.origin);
    if (!origins.length) return 'Lade Daten...';
    if (origins.every((o) => o === 'Supabase')) return 'Supabase Live';
    if (origins.some((o) => o === 'Supabase')) return 'Supabase + Lokal';
    return 'Lokal (auswertung/)';
  }, [raw]);

  const persistFeedbackRow = useCallback(
    async (newRow: FeedbackRow, apiPayload: Record<string, any>): Promise<{ ok: boolean; msg: string }> => {
      // 1. Optimistic in-memory & localStorage update
      setExtraFeedback((prev) => {
        const filtered = prev.filter((r) => r.id !== newRow.id);
        const next = [...filtered, newRow];
        try {
          localStorage.setItem(LOCAL_FB_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });

      // 2. Call Vite server middleware (/api/feedback) which writes athlet/feedback.json + journal + Supabase
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiPayload),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.ok) {
            return {
              ok: true,
              msg: j.supaOk
                ? 'Im Repo-Brain (athlet/feedback.json + Journal) & Supabase gespeichert'
                : 'Im lokalen Repo-Brain (athlet/feedback.json + Journal) gespeichert',
            };
          }
        }
      } catch {
        // Fallback if static build
      }

      // 3. Direct Supabase fallback if available
      if (supa) {
        try {
          const merged = [...feedback.filter((r) => r.id !== newRow.id), newRow];
          const { error } = await supa.from('datasets').upsert({
            name: 'feedback',
            part: 0,
            rows: merged,
            meta: [{ label: 'Stand', value: new Date().toISOString().slice(0, 16).replace('T', ' ') }],
          });
          if (!error) {
            return { ok: true, msg: 'In Supabase & Browser gespeichert' };
          }
        } catch {
          // ignore
        }
      }

      return { ok: true, msg: 'Lokal gespeichert' };
    },
    [feedback]
  );

  const saveTagesform = useCallback(
    async (input: { datum: string; beine: number; stress: number; schlaf_qualitaet: number; notiz: string }) => {
      const nowIso = new Date().toISOString();
      const row: FeedbackRow = {
        id: `tf_${input.datum}`,
        typ: 'tagesform',
        datum: input.datum,
        activity_id: '',
        beine: input.beine,
        stress: input.stress,
        schlaf_qualitaet: input.schlaf_qualitaet,
        rpe: null,
        gefuehl: '',
        notiz: input.notiz,
        updated_at: nowIso,
      };
      return persistFeedbackRow(row, { typ: 'tagesform', ...input });
    },
    [persistFeedbackRow]
  );

  const saveRpe = useCallback(
    async (input: { activity_id: string; datum: string; titel: string; rpe: number; gefuehl: string; notiz: string }) => {
      const nowIso = new Date().toISOString();
      const row: FeedbackRow = {
        id: `rpe_${input.activity_id}`,
        typ: 'rpe',
        datum: input.datum,
        activity_id: String(input.activity_id),
        beine: null,
        stress: null,
        schlaf_qualitaet: null,
        rpe: input.rpe,
        gefuehl: input.gefuehl,
        notiz: input.notiz,
        updated_at: nowIso,
      };
      return persistFeedbackRow(row, { typ: 'rpe', ...input });
    },
    [persistFeedbackRow]
  );

  const recalcAndSync = useCallback(async () => {
    try {
      const r = await fetch('/api/recalc', { method: 'POST' });
      if (r.ok) {
        await fetchAll();
        return true;
      }
    } catch {
      // ignore
    }
    await fetchAll();
    return false;
  }, [fetchAll]);

  return {
    loading,
    sourceBadge,
    stand,
    aktivitaeten: (raw.aktivitaeten?.rows || []) as Activity[],
    einheitenById,
    tage,
    wochen: (raw.wochen?.rows || []) as WeeklySummary[],
    kalender: (raw.kalender?.rows || []) as CalendarPlanItem[],
    kpis,
    fortschrittKpis: (raw.fortschritt?.rows || []) as KPI[],
    trends: (raw.trends?.rows || []) as TrendItem[],
    trainer: (raw.trainer?.rows || []) as TrainerItem[],
    events: (raw.events?.rows || []) as EventItem[],
    marker: (raw.marker?.rows || []) as MarkerItem[],
    ftpBuilder: (raw.ftp_builder?.rows || []) as FtpBuilderItem[],
    effizienz: (raw.effizienz?.rows || []) as EffizienzPoint[],
    drift: (raw.drift?.rows || []) as DriftPoint[],
    bestwerte: (raw.bestwerte?.rows || []) as BestwertItem[],
    vo2max: (raw.vo2max?.rows || []) as Vo2MaxPoint[],
    radEffizienz: (raw.rad_effizienz?.rows || []) as RadEffPoint[],
    laender: (raw.laender?.rows || []) as LandItem[],
    karte: raw.karte?.rows || [],
    trainingsplan,
    feedback,
    tagesformByDate,
    rpeByActivity,
    saveTagesform,
    saveRpe,
    recalcAndSync,
  };
}
