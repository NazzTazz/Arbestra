import { Component, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminSession } from '@arbestra/contracts';
import { currentSession, errorMessage, request, SessionExpiry } from './api';
import { absoluteTime, shortId } from './format';
import { Empty } from './components';
import { HttpRequestDetailView, HttpRequestsPageView } from './http-diagnostics';
import { ObservationPage } from './observation';
import {
  AccountPage,
  AccountsPage,
  ActivitiesPage,
  ActivityPage,
  AdministrationPage,
  InfrastructurePage,
  OverviewPage,
  VillagePage,
  WorldPage,
  WorldsPage,
} from './pages';

type Section = 'overview' | 'infrastructure' | 'worlds' | 'accounts' | 'activities' | 'administration';
const navigation: Array<{ key: Section; title: string; eyebrow?: string; icon: ReactNode }> = [
  {
    key: 'overview',
    title: 'Vue d’ensemble',
    eyebrow: 'Supervision',
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
  },
  {
    key: 'infrastructure',
    title: 'Infrastructure',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="7" rx="2" />
        <rect x="3" y="14" width="18" height="7" rx="2" />
        <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
      </>
    ),
  },
  {
    key: 'worlds',
    title: 'Mondes',
    eyebrow: 'Exploration',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
  },
  {
    key: 'accounts',
    title: 'Comptes',
    icon: (
      <>
        <circle cx="10" cy="8" r="4" />
        <path d="M3 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M21 21v-2a7 7 0 0 0-3-5.7" />
      </>
    ),
  },
  { key: 'activities', title: 'Activités', icon: <path d="M2 12h4l3-8 5 16 3-8h5" /> },
  {
    key: 'administration',
    title: 'Administration',
    eyebrow: 'Console',
    icon: (
      <>
        <path d="m12 3 8 4v6c0 4-5 7-8 8-3-1-8-4-8-8V7Z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
  },
];

class ConsoleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <main className="fatal-screen">
          <h1>La console n’a pas pu afficher ces données.</h1>
          <p>Rechargez la page pour rouvrir une session de lecture.</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Recharger la console
          </button>
        </main>
      );
    return this.props.children;
  }
}

function Login({
  onAuthenticated,
  initialError,
}: {
  onAuthenticated: (session: AdminSession) => void;
  initialError: string | null;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const session = await request<AdminSession>('/api/admin/session', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setPassword('');
      onAuthenticated(session);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-story">
        <a className="brand" href="#/overview">
          <span className="brand-mark">A</span>
          <span>
            ARBESTRA<small>OPERATIONS CONSOLE</small>
          </span>
        </a>
        <div className="login-intro">
          <span className="eyebrow">Centre de supervision</span>
          <h1>
            Chaque monde.
            <br />
            <em>Une vue claire.</em>
          </h1>
          <p>
            Observer les services, comprendre l’activité et diagnostiquer les installations depuis une console dédiée.
          </p>
          <div className="login-grid" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <span className="login-footnote">ACCÈS OPÉRATEUR · SESSION SÉPARÉE DU JEU</span>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">Authentification</span>
          <h2>Ouvrir la console</h2>
          <p className="muted">Connectez-vous avec un compte autorisé à consulter la supervision.</p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Adresse e-mail
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
                disabled={pending}
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={pending}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? 'Vérification de l’accès…' : 'Se connecter'} <span aria-hidden="true">→</span>
            </button>
          </form>
          <div className="access-note">
            <span aria-hidden="true">◈</span>
            <p>
              Console en lecture seule.
              <br />
              Les autorisations sont vérifiées par le serveur.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/overview');
  useEffect(() => {
    const changed = () => setHash(window.location.hash || '#/overview');
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const url = new URL(hash.slice(1) || '/overview', window.location.origin);
  const parts = url.pathname.split('/').filter(Boolean),
    section = parts[0] ?? 'overview';
  return { hash, section, id: parts[1], detailId: parts[2], query: url.searchParams, queryString: url.search.slice(1) };
}
function Page({ route }: { route: ReturnType<typeof useRoute> }) {
  const { section, id, query, queryString } = route;
  if (section === 'observe' && query.get('worldId') && query.get('villageId'))
    return <ObservationPage worldId={query.get('worldId')!} villageId={query.get('villageId')!} />;
  if (section === 'overview') return <OverviewPage />;
  if (section === 'infrastructure' && id === 'http') {
    if (route.detailId && query.get('instanceId'))
      return (
        <HttpRequestDetailView
          requestId={route.detailId}
          instanceId={query.get('instanceId')!}
          returnTo={query.get('returnTo')}
        />
      );
    return route.detailId ? (
      <Empty>
        La référence d’une requête comprend l’instance serveur. Ouvrez le détail depuis les observations conservées.
      </Empty>
    ) : (
      <HttpRequestsPageView queryString={queryString} />
    );
  }
  if (section === 'infrastructure') return <InfrastructurePage queryString={queryString} />;
  if (section === 'worlds') return id ? <WorldPage id={id} /> : <WorldsPage />;
  if (section === 'accounts') return id ? <AccountPage id={id} /> : <AccountsPage worldId={query.get('worldId')} />;
  if (section === 'villages' && id && query.get('worldId'))
    return <VillagePage id={id} worldId={query.get('worldId')!} />;
  if (section === 'activities')
    return id && query.get('worldId') && query.get('kind') ? (
      <ActivityPage
        id={id}
        worldId={query.get('worldId')!}
        kind={query.get('kind')!}
        villageId={query.get('villageId')}
      />
    ) : !id ? (
      <ActivitiesPage queryString={queryString} />
    ) : (
      <Empty>
        Le diagnostic d’une activité requiert son monde et son type. Ouvrez-la depuis une liste d’activités.
      </Empty>
    );
  if (section === 'administration') return <AdministrationPage />;
  return (
    <Empty>
      Ce lien ne contient pas un périmètre de diagnostic valide. <a href="#/overview">Retour à la vue d’ensemble</a>.
    </Empty>
  );
}
function Console({ session, onLogout }: { session: AdminSession; onLogout: () => void }) {
  const route = useRoute(),
    [menuOpen, setMenuOpen] = useState(false),
    [now, setNow] = useState(Date.now());
  const [logoutPending, setLogoutPending] = useState(false),
    [logoutError, setLogoutError] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [route.hash]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const activeSection = route.section === 'villages' ? 'worlds' : route.section;
  async function logout() {
    setLogoutPending(true);
    setLogoutError(null);
    try {
      await request<void>('/api/admin/session', { method: 'DELETE' });
      onLogout();
    } catch (error) {
      setLogoutError(errorMessage(error));
    } finally {
      setLogoutPending(false);
    }
  }
  return (
    <div className={`console-shell${menuOpen ? ' menu-open' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Aller au contenu
      </a>
      <aside className="sidebar" id="console-navigation">
        <a className="brand" href="#/overview">
          <span className="brand-mark">A</span>
          <span>
            ARBESTRA<small>OPERATIONS</small>
          </span>
        </a>
        <nav aria-label="Navigation de la console">
          {navigation.map((item) => (
            <div key={item.key}>
              {item.eyebrow && <span className="nav-group">{item.eyebrow}</span>}
              <a
                href={`#/${item.key}`}
                className={activeSection === item.key ? 'is-active' : ''}
                aria-current={activeSection === item.key ? 'page' : undefined}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {item.icon}
                </svg>
                {item.title}
                {activeSection === item.key && <span className="nav-active-dot" />}
              </a>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="operator-avatar" aria-hidden="true">
            OP
          </span>
          <div>
            <strong>Opérateur</strong>
            <code title={session.account.id}>{shortId(session.account.id)}</code>
          </div>
          <button
            type="button"
            className="logout-button"
            onClick={() => void logout()}
            disabled={logoutPending}
            aria-label="Se déconnecter"
            title="Se déconnecter"
          >
            ↪
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button className="menu-scrim" aria-label="Fermer la navigation" onClick={() => setMenuOpen(false)} />
      )}
      <div className="workspace">
        <header className="topbar">
          <div>
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'}
              aria-expanded={menuOpen}
              aria-controls="console-navigation"
              onClick={() => setMenuOpen((value) => !value)}
            >
              ☰
            </button>
            <span className="topbar-title">Centre de supervision</span>
            <span className="topbar-divider">/</span>
            <span className="muted">
              {navigation.find((item) => item.key === activeSection)?.title ?? 'Diagnostic'}
            </span>
          </div>
          <div className="topbar-right">
            <span className="console-version">NOC · V1.1</span>
            <time dateTime={new Date(now).toISOString()}>{absoluteTime(now)}</time>
          </div>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {logoutError && (
            <p className="form-error" role="alert">
              Déconnexion impossible : {logoutError}{' '}
              <button className="text-button" onClick={() => void logout()}>
                Réessayer
              </button>
            </p>
          )}
          <Page key={route.hash} route={route} />
        </main>
        <footer className="workspace-footer">
          <span>ARBESTRA / OPERATIONS</span>
          <span>
            Horaires locaux · {Intl.DateTimeFormat().resolvedOptions().timeZone} · Observations en lecture seule
          </span>
        </footer>
      </div>
    </div>
  );
}

function SessionGate() {
  const [session, setSession] = useState<AdminSession | null>(null),
    [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setInitialError(null);
    void currentSession()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((error) => {
        if (active) setInitialError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const expired = useCallback(() => {
    setSession(null);
    setInitialError('Votre accès a expiré ou a été retiré. Reconnectez-vous avec un compte autorisé.');
  }, []);
  if (loading)
    return (
      <main className="session-loading" role="status">
        <span className="brand-mark">A</span>
        <p>Vérification de la session opérateur…</p>
      </main>
    );
  if (!session)
    return (
      <>
        <Login
          onAuthenticated={(value) => {
            setInitialError(null);
            setSession(value);
          }}
          initialError={initialError}
        />
        {initialError && (
          <button className="session-retry text-button" onClick={() => setAttempt((value) => value + 1)}>
            Vérifier à nouveau la session
          </button>
        )}
      </>
    );
  return (
    <SessionExpiry.Provider value={expired}>
      <Console
        session={session}
        onLogout={() => {
          setInitialError(null);
          setSession(null);
        }}
      />
    </SessionExpiry.Provider>
  );
}
export function App() {
  return (
    <ConsoleBoundary>
      <SessionGate />
    </ConsoleBoundary>
  );
}
