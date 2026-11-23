export type PageId = 'cockpit' | 'plan' | 'form' | 'aktivitaeten' | 'events';

export interface Activity {
  id: string;
  datum: string;
  start: string;
  dauer_gesamt_min: number;
  tag: string;
  woche: string;
  sport: string;
  titel: string;
  dauer_min: number;
  distanz_km: number;
  tempo: string;
  puls_avg: number | null;
  puls_max: number | null;
  leistung_np: number | null;
  hm_auf: number;
  hm_ab: number;
  z1_min: number;
  z2_min: number;
  z3_min: number;
  z4_min: number;
  rad_schwelle_min: number;
  rad_vo2_min: number;
  reiz: string;
  hart: boolean;
  last: number;
  last_quelle: string;
  split5k: string;
  split5k_s: number | null;
  renntempo_min: number;
}

export interface LapRow {
  nr: number;
  zeit_s: number;
  distanz_m: number;
  tempo_s: number | null;
  puls: number | null;
  puls_max: number | null;
  watt: number | null;
}

export interface CoachCheck {
  punkt: string;
  stufe: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
  text: string;
}

export interface EinheitDetail {
  id: string;
  einordnung: string;
  fazit: string;
  fazit_stufe: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
  checks: string; // JSON of CoachCheck[]
  runden: string; // JSON of LapRow[]
  drift_pct: number | null;
  z5_1_min?: number;
  z5_2_min?: number;
  z5_3_min?: number;
  z5_4_min?: number;
  z5_5_min?: number;
  land?: string;
  land_de?: string;
  rpe?: number | null;
  rpe_gefuehl?: string;
  rpe_notiz?: string;
}

export interface DailyMetric {
  datum: string;
  last: number;
  fitness_ctl: number;
  ermuedung_atl: number;
  form_tsb: number;
  ruhepuls: number | null;
  ruhepuls_7t: number | null;
  schlaf_h: number | null;
}

export interface WeeklySummary {
  woche: string;
  start: string;
  h_lauf: number;
  h_rad: number;
  h_schwimmen: number;
  h_sonst: number;
  km_lauf: number;
  last: number;
  harte_reize: number;
  schwimm_einheiten: number;
  h_gesamt: number;
  lauf_locker_anteil: number | null;
}

export interface KPI {
  id: string;
  kpi: string;
  wert?: number | null;
  wert_text: string;
  einheit: string;
  vergleich: string;
  bewertung: 'gut' | 'warn' | 'schlecht' | 'neutral';
  fenster: string;
  hinweis: string;
}

export interface TrendItem {
  id: string;
  kennzahl: string;
  jetzt: number | null;
  vorher: number | null;
  delta: number | null;
  jetzt_text: string;
  vorher_text: string;
  delta_text: string;
  einheit: string;
  richtung: 'besser' | 'schlechter' | 'gleich' | 'neutral';
  fenster: string;
}

export interface TrainerItem {
  id: string;
  abschnitt: 'takeaways' | 'gut' | 'schlecht' | 'fokus';
  nr: number;
  text: string;
  stand: string;
}

export interface EventItem {
  id: string;
  datum: string;
  datum_bis: string;
  typ: 'anstehend' | 'vergangen';
  art: string;
  prio: string;
  name: string;
  ort: string;
  land: string;
  lat: number | null;
  lon: number | null;
  ergebnis: string;
  ziel: string;
  status: string;
  prognose: string;
  konfidenz: string;
  begruendung: string;
  hebel: string;
  naechster_check: string;
  stand: string;
  strecke: string;
  hinweis: string;
  aktivitaeten: string;
  route: string;
  tage_bis: number;
}

export interface MarkerItem {
  disziplin: string;
  marker: string;
  wert: string;
  datum: string;
  quelle: string;
  gueltig_bis: string;
  gueltigkeit: 'gültig' | 'abgelaufen' | 'offen' | 'ohne Ablauf';
  status: string;
}

export interface FtpBuilderItem {
  nr: string;
  einheit: string;
  optional: boolean;
  dauer_min: number;
  inhalt: string;
  zaehlt_als: string;
  reihenfolge: number;
  status: 'erledigt' | 'offen' | 'optional';
  erledigt_am: string;
  aktivitaet_id?: string;
  hart: boolean;
}

export interface CalendarPlanItem {
  woche: string;
  woche_titel: string;
  woche_start: string;
  datum: string;
  tag: string;
  sport: string;
  reiz: string;
  titel: string;
  details: string;
  ebene: string;
  status: 'erledigt' | 'offen' | 'verfallen';
  erledigt_am: string;
  aktivitaet_id: string;
  zeit: string;
  plan_dauer_min: number | string;
}

export interface EffizienzPoint {
  datum: string;
  id: string;
  puls: number;
  tempo_s: number;
  tempo145_s: number;
  dauer_min: number;
  trend145_s: number | null;
  tempo_text: string;
  tempo145_text: string;
  trend145_text: string;
}

export interface DriftPoint {
  datum: string;
  id: string;
  sport: string;
  dauer_min: number;
  drift_pct: number;
}

export interface Vo2MaxPoint {
  datum: string;
  vo2max: number;
}

export interface RadEffPoint {
  datum: string;
  id: string;
  titel: string;
  np: number;
  puls: number;
  ef: number;
}

export interface BestwertItem {
  id: string;
  kennzahl: string;
  einheit: string;
  jetzt_text: string;
  jetzt_datum: string;
  jetzt_id?: string;
  vorher_text: string;
  vorher_datum?: string;
  vorher_id?: string;
  gesamt_text: string;
  gesamt_datum: string;
  gesamt_id?: string;
  richtung: 'besser' | 'schlechter' | 'gleich' | 'keine';
}

export interface LandItem {
  land: string;
  name_de: string;
  aktivitaeten: number;
  stunden: number;
  erstes: string;
  letztes: string;
  aktivitaet_ids?: string;
}

export interface BlockWeekItem {
  tag: string;
  wochentag: string;
  zeit: string;
  sport: string;
  reiz: string;
  titel: string;
  details: string;
  ebene: string;
  dauer_min: number;
  distanz_km?: number;
  zone: string;
  warum: string;
  hart: boolean;
  status: 'erledigt' | 'offen' | 'verfallen';
  erledigt_am: string;
  aktivitaet_id: string;
}

export interface BlockWeek {
  woche: string;
  start: string;
  titel: string;
  phase: string;
  ziel: string;
  h_lauf: number;
  h_rad: number;
  h_schwimmen: number;
  h_sonst: number;
  h_gesamt: number;
  km_lauf: number;
  harte_reize: number;
  schwimm_einheiten: number;
  kraft_einheiten: number;
  quali_lauf_km: number;
  lit_min: number;
  z4_min: number;
  z5_min: number;
  erledigt: number;
  gesamt: number;
  items: BlockWeekItem[];
}

export interface TrainingsplanPayload {
  stand: string;
  ziele: {
    langzeit: {
      name: string;
      datum: string;
      ziel: string;
      prio: string;
      splits_ziel: string;
      hebel: string;
    };
    nahziel: {
      name: string;
      datum: string;
      ziel: string;
      prio: string;
      block: string;
      mission: string;
      naechster_check: string;
    };
  };
  radar: {
    id: string;
    label: string;
    titel: string;
    untertitel: string;
    datenbasis: string;
    diagnose: {
      schwaeche: string;
      hebel: string;
      staerke: string;
    };
    achsen: {
      name: string;
      ist: number;
      proj: number;
      ziel: number;
      einheit: string;
    }[];
  }[];
  ironman_splits: {
    hinweis: string;
    szenarien: {
      id: string;
      label: string;
      gesamt_min: number;
      gesamt_text: string;
      spanne: string;
      bewertung: string;
      splits: Record<'swim' | 't1' | 'bike' | 't2' | 'run', { min: number; text: string; detail: string }>;
    }[];
  };
  phasen: {
    id: string;
    nr: number;
    name: string;
    zeitraum: string;
    start: string;
    ende: string;
    wochen: number;
    status: 'aktiv' | 'leitplanke';
    volumen_h: string;
    ctl_ziel: string;
    intensitaet: string;
    fokus: string;
    alltag_70h: string;
    meilensteine: string[];
  }[];
  ist_wochen: any[];
  makro_wochen: any[];
  block_wochen: BlockWeek[];
}

export interface FeedbackRow {
  id: string;
  typ: 'tagesform' | 'rpe';
  datum: string;
  activity_id: string;
  beine: number | null;
  stress: number | null;
  schlaf_qualitaet: number | null;
  rpe: number | null;
  gefuehl: string;
  notiz: string;
  updated_at: string;
}

export type DrawerState =
  | { type: 'activity'; id: string }
  | {
      type: 'planned';
      item: {
        woche?: string;
        woche_titel?: string;
        datum?: string;
        wochentag?: string;
        zeit?: string;
        sport: string;
        reiz: string;
        titel: string;
        details: string;
        ebene?: string;
        dauer_min?: number | string;
        distanz_km?: number;
        zone?: string;
        warum?: string;
        hart?: boolean;
        status?: string;
        erledigt_am?: string;
        aktivitaet_id?: string;
      };
    }
  | { type: 'event'; id: string }
  | { type: 'country'; land: string }
  | { type: 'week'; woche: string }
  | { type: 'ftp'; nr: string }
  | { type: 'readiness'; datum?: string }
  | { type: 'day'; datum: string }
  | null;
