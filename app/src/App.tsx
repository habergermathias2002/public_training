import React, { useCallback, useEffect, useState } from 'react';
import { useCockpitData } from './data/useCockpitData';
import { DrawerState, PageId } from './types';
import { WorldMapCockpit } from './components/WorldMapCockpit';
import { PlanKalenderPage } from './components/PlanKalenderPage';
import { FormFortschrittPage } from './components/FormFortschrittPage';
import { AktivitaetenPage } from './components/AktivitaetenPage';
import { EventsPage } from './components/EventsPage';
import { SlideOverDrawer } from './components/SlideOverDrawer';
import { CommandPalette } from './components/CommandPalette';
import { TODAY_ISO } from './utils/format';

const VALID_PAGES: PageId[] = ['cockpit', 'plan', 'form', 'aktivitaeten', 'events'];

function parseHash(): { page: PageId; sub: string | null } {
  const raw = window.location.hash.replace(/^#/, '');
  const [p, s] = raw.split('/');
  if (p === 'dashboard' || p === 'fortschritt') return { page: 'form', sub: s || null };
  if (p === 'trainingsplan' || p === 'kalender') return { page: 'plan', sub: p === 'kalender' ? 'kalender' : 'strategie' };
  const page = VALID_PAGES.includes(p as PageId) ? (p as PageId) : 'cockpit';
  return { page, sub: s || null };
}

export const App: React.FC = () => {
  const store = useCockpitData();
  const [{ page, sub }, setRoute] = useState<{ page: PageId; sub: string | null }>(parseHash);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [flyTargetId, setFlyTargetId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>(() => {
    return (localStorage.getItem('ic_theme') as any) || 'dark';
  });

  // Apply theme attribute
  useEffect(() => {
    localStorage.setItem('ic_theme', theme);
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Browser Back/Forward support
  useEffect(() => {
    const onPop = () => setRoute(parseHash());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const navigate = useCallback((nextPage: PageId, nextSub?: string) => {
    const hash = nextSub ? `#${nextPage}/${nextSub}` : `#${nextPage}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setRoute({ page: nextPage, sub: nextSub || null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const flyToEventOnMap = useCallback((eventId: string) => {
    navigate('cockpit');
    setTimeout(() => setFlyTargetId(eventId), 60);
  }, [navigate]);

  // Global keyboard shortcuts (Cmd+K / Ctrl+K, 1..5 when not typing in input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1') navigate('cockpit');
      if (e.key === '2') navigate('plan');
      if (e.key === '3') navigate('form');
      if (e.key === '4') navigate('aktivitaeten');
      if (e.key === '5') navigate('events');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const tagesformKpi = store.kpis.find((k) => k.id === 'tagesform');

  const handleRecalc = async () => {
    setSyncing(true);
    await store.recalcAndSync();
    setSyncing(false);
  };

  return (
    <div className="ic-shell">
      <aside className="ic-side" aria-label="Navigation">
        <div className="ic-brand">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ic-brand-name">Ironman Cockpit</span>
            <span className="ic-kbd-pill" title="Tastaturkürzel 1–5 & ⌘K">
              v2
            </span>
          </div>
          <span className="ic-brand-sub">Endurance Performance Cockpit</span>
        </div>

        {/* Cmd+K Search Trigger */}
        <button
          type="button"
          className="ic-cmd-trigger"
          onClick={() => setCmdOpen(true)}
          title="Schnellsuche & Sprungmenü (⌘K)"
        >
          <span>⌕ Suche &amp; Quick-Jump...</span>
          <kbd>⌘K</kbd>
        </button>

        {/* 5-Page Navigation */}
        <nav className="ic-nav">
          <button
            type="button"
            aria-current={page === 'cockpit' ? 'page' : undefined}
            onClick={() => navigate('cockpit')}
          >
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6.2" />
              <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" />
            </svg>
            <span style={{ flex: 1 }}>Cockpit</span>
            <kbd className="ic-nav-kbd">1</kbd>
          </button>

          <button
            type="button"
            aria-current={page === 'plan' ? 'page' : undefined}
            onClick={() => navigate('plan')}
          >
            <svg viewBox="0 0 16 16">
              <rect x="2" y="3" width="12" height="11" rx="1.5" />
              <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
            </svg>
            <span style={{ flex: 1 }}>Plan &amp; Kalender</span>
            <kbd className="ic-nav-kbd">2</kbd>
          </button>

          <button
            type="button"
            aria-current={page === 'form' ? 'page' : undefined}
            onClick={() => navigate('form')}
          >
            <svg viewBox="0 0 16 16">
              <path d="M1.5 12.5l4-4.5 3 3 6-7M10.5 4h4v4" />
            </svg>
            <span style={{ flex: 1 }}>Form &amp; Fortschritt</span>
            <kbd className="ic-nav-kbd">3</kbd>
          </button>

          <button
            type="button"
            aria-current={page === 'aktivitaeten' ? 'page' : undefined}
            onClick={() => navigate('aktivitaeten')}
          >
            <svg viewBox="0 0 16 16">
              <path d="M1.5 8.5h3l2-5 3 9 2-4h3" />
            </svg>
            <span style={{ flex: 1 }}>Aktivitäten</span>
            <kbd className="ic-nav-kbd">4</kbd>
          </button>

          <button
            type="button"
            aria-current={page === 'events' ? 'page' : undefined}
            onClick={() => navigate('events')}
          >
            <svg viewBox="0 0 16 16">
              <path d="M3.5 14.5v-13M3.5 2h8.5l-1.8 3 1.8 3H3.5" />
            </svg>
            <span style={{ flex: 1 }}>Events</span>
            <kbd className="ic-nav-kbd">5</kbd>
          </button>
        </nav>

        {/* Quick Readiness Check-in Card in Sidebar */}
        <div className="ic-side-readiness">
          <button
            type="button"
            className="ic-readiness-btn"
            onClick={() => setDrawer({ type: 'readiness', datum: TODAY_ISO })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`ic-status-dot ${tagesformKpi?.bewertung || 'gut'}`} />
              <b>Tagesform: {(tagesformKpi?.wert_text || 'grün').toUpperCase()}</b>
            </div>
            <span className="ic-ev-meta">Beine &amp; Stress Check-in ↗</span>
          </button>
        </div>

        <div className="ic-side-foot">
          {/* Theme Switcher */}
          <div className="ic-theme-seg" role="group" aria-label="Farbschema">
            {(
              [
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['auto', 'Auto'],
              ] as const
            ).map(([t, label]) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 8 }}>
            Stand: <b>{store.stand}</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <span className="app-quelle">Daten: {store.sourceBadge}</span>
            <button
              type="button"
              className="ic-btn ic-btn-xs"
              onClick={handleRecalc}
              disabled={syncing}
              title="auswertung.py & sync_supabase.py ausführen"
            >
              {syncing ? '⟳ Sync...' : '↻ Sync'}
            </button>
          </div>
        </div>
      </aside>

      <main className="ic-main">
        {page === 'cockpit' && (
          <WorldMapCockpit
            store={store}
            openDrawer={setDrawer}
            navigate={navigate}
            flyTargetId={flyTargetId}
            onFlyComplete={() => setFlyTargetId(null)}
          />
        )}
        {page === 'plan' && (
          <PlanKalenderPage
            store={store}
            openDrawer={setDrawer}
            initialSubTab={sub}
          />
        )}
        {page === 'form' && (
          <FormFortschrittPage
            store={store}
            openDrawer={setDrawer}
            focusSection={sub}
          />
        )}
        {page === 'aktivitaeten' && (
          <AktivitaetenPage
            store={store}
            openDrawer={setDrawer}
          />
        )}
        {page === 'events' && (
          <EventsPage
            store={store}
            openDrawer={setDrawer}
            navigate={navigate}
            flyToEventOnMap={flyToEventOnMap}
          />
        )}
      </main>

      {/* Universal Right Slide-Over Drawer */}
      <SlideOverDrawer
        drawer={drawer}
        onClose={() => setDrawer(null)}
        openDrawer={setDrawer}
        navigate={navigate}
        flyToEventOnMap={flyToEventOnMap}
        store={store}
      />

      {/* Global Cmd+K Command Palette */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        store={store}
        navigate={navigate}
        openDrawer={setDrawer}
      />
    </div>
  );
};
