import { type FormEvent, useEffect, useState } from 'react';

import type { SessionResponse } from '@arbestra/contracts';

import { getSession, login, logout } from './api/client';

const WORLD_CLIENT_URL = import.meta.env.VITE_WORLD_CLIENT_URL ?? 'http://localhost:5174';

function worldUrl(slug: string): string {
  return WORLD_CLIENT_URL.includes('{world}')
    ? WORLD_CLIENT_URL.replace('{world}', slug)
    : `${WORLD_CLIENT_URL}?world=${encodeURIComponent(slug)}`;
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSession()
      .then(setSession)
      .catch(() => setError('Le serveur est momentanément inaccessible.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      setSession(await login({ email: String(form.get('email')), password: String(form.get('password')) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connexion impossible.');
    }
  }

  async function handleLogout() {
    await logout();
    setSession(null);
  }

  return (
    <main className="lobby-shell">
      <section className="lobby-card" aria-busy={loading}>
        <p className="eyebrow">Arbestra</p>
        <h1>{session ? `Bienvenue, ${session.worlds[0]?.playerName ?? session.account.email}` : 'Entrer dans le monde'}</h1>
        {loading ? <p>Chargement de la session…</p> : null}
        {!loading && !session ? (
          <form onSubmit={handleLogin} className="login-form">
            <label>
              Adresse e-mail
              <input name="email" type="email" defaultValue="player@arbestra.local" autoComplete="username" required />
            </label>
            <label>
              Mot de passe
              <input name="password" type="password" defaultValue="arbestra" autoComplete="current-password" required />
            </label>
            <button type="submit">Se connecter</button>
          </form>
        ) : null}
        {session ? (
          <div className="world-list">
            {session.worlds.map((world) => (
              <a className="world-card" href={worldUrl(world.slug)} key={world.id}>
                <strong>{world.name}</strong>
                <span>Jouer en tant que {world.playerName}</span>
              </a>
            ))}
            <button className="quiet-button" type="button" onClick={() => void handleLogout()}>Se déconnecter</button>
          </div>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
