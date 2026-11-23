-- Supabase Schema für das Trainings-Brain
-- Ausführen im Supabase SQL Editor: Dashboard -> SQL Editor -> New query -> Run

-- 1. Aktivitäten (alle Einheiten aus Garmin & Auswertung)
create table if not exists activities (
  id bigint primary key,
  datum date not null,
  start text,
  dauer_gesamt_min numeric,
  tag text,
  woche text,
  sport text,
  titel text,
  dauer_min numeric,
  distanz_km numeric,
  tempo text,
  puls_avg integer,
  puls_max integer,
  leistung_np numeric,
  hm_auf numeric,
  hm_ab numeric,
  z1_min numeric,
  z2_min numeric,
  z3_min numeric,
  z4_min numeric,
  rad_schwelle_min numeric,
  rad_vo2_min numeric,
  reiz text,
  hart boolean default false,
  last numeric,
  last_quelle text,
  split5k text,
  split5k_s numeric,
  renntempo_min numeric,
  updated_at timestamptz default now()
);

-- 2. Tageswerte & Belastungssteuerung
create table if not exists daily_metrics (
  datum date primary key,
  last numeric,
  fitness_ctl numeric,
  ermuedung_atl numeric,
  form_tsb numeric,
  ruhepuls numeric,
  ruhepuls_7t numeric,
  schlaf_h numeric,
  updated_at timestamptz default now()
);

-- 3. Wochenaggregationen
create table if not exists weekly_summaries (
  woche text primary key,
  start date,
  h_lauf numeric,
  h_rad numeric,
  h_schwimmen numeric,
  h_sonst numeric,
  km_lauf numeric,
  last numeric,
  harte_reize integer,
  schwimm_einheiten integer,
  h_gesamt numeric,
  lauf_locker_anteil numeric,
  updated_at timestamptz default now()
);

-- 4. Kacheln & KPIs
create table if not exists kpis (
  id text primary key,
  kpi text not null,
  wert numeric,
  wert_text text,
  einheit text,
  vergleich text,
  bewertung text,
  fenster text,
  hinweis text,
  updated_at timestamptz default now()
);

-- 5. Events & Rennen
create table if not exists events (
  id text primary key,
  datum date,
  datum_bis date,
  typ text,
  art text,
  prio text,
  name text not null,
  ort text,
  land text,
  lat numeric,
  lon numeric,
  ergebnis text,
  ziel text,
  status text,
  prognose text,
  konfidenz text,
  begruendung text,
  hebel text,
  naechster_check text,
  stand text,
  strecke text,
  hinweis text,
  aktivitaeten jsonb,
  route jsonb,
  tage_bis integer,
  updated_at timestamptz default now()
);

-- 6. Leistungswerte & Marker
create table if not exists markers (
  id text primary key,
  disziplin text,
  marker text not null,
  wert text,
  datum text,
  quelle text,
  gueltig_bis text,
  gueltigkeit text,
  status text,
  updated_at timestamptz default now()
);

-- 7. Kalender & Trainingsplan (Soll vs. Ist)
create table if not exists calendar_plan (
  id text primary key,
  woche text,
  woche_titel text,
  woche_start date,
  datum date,
  tag text,
  sport text,
  reiz text,
  titel text,
  details text,
  ebene text,
  status text,
  erledigt_am text,
  aktivitaet_id bigint,
  zeit text,
  plan_dauer_min numeric,
  updated_at timestamptz default now()
);

-- 8. AI-Trainer Feedback & Briefings
create table if not exists trainer_briefings (
  id text primary key,
  abschnitt text,
  nr integer,
  text text,
  stand text,
  updated_at timestamptz default now()
);

-- Row-Level-Security aktivieren & Lesezugriff für Frontend erlauben
alter table activities enable row level security;
alter table daily_metrics enable row level security;
alter table weekly_summaries enable row level security;
alter table kpis enable row level security;
alter table events enable row level security;
alter table markers enable row level security;
alter table calendar_plan enable row level security;
alter table trainer_briefings enable row level security;

-- Lesezugriff für anonyme / authentifizierte Nutzer (lokale Web-App)
create policy "Allow read access for all" on activities for select using (true);
create policy "Allow read access for all" on daily_metrics for select using (true);
create policy "Allow read access for all" on weekly_summaries for select using (true);
create policy "Allow read access for all" on kpis for select using (true);
create policy "Allow read access for all" on events for select using (true);
create policy "Allow read access for all" on markers for select using (true);
create policy "Allow read access for all" on calendar_plan for select using (true);
create policy "Allow read access for all" on trainer_briefings for select using (true);

-- Schreibzugriff (Upsert/Insert/Update) für Service-Role (Backend-Sync)
create policy "Allow service role full access" on activities for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on daily_metrics for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on weekly_summaries for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on kpis for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on events for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on markers for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on calendar_plan for all using (auth.jwt() ->> 'role' = 'service_role');
create policy "Allow service role full access" on trainer_briefings for all using (auth.jwt() ->> 'role' = 'service_role');

-- 9. Datensätze für die App: jede Datei aus auswertung/ unverändert (rows + meta).
--    Große Dateien liegen in mehreren Teilen (part 0, 1, ...), die App hängt sie in dieser Reihenfolge zusammen.
--    Befüllt von bin/sync_supabase.py, gelesen von app/src/main.ts.
create table if not exists datasets (
  name text not null,
  part integer not null default 0,
  rows jsonb not null,
  meta jsonb,
  updated_at timestamptz default now(),
  primary key (name, part)
);

alter table datasets enable row level security;
create policy "Allow read access for all" on datasets for select using (true);
create policy "Allow service role full access" on datasets for all using (auth.jwt() ->> 'role' = 'service_role');
