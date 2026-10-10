import { type FormEvent, useEffect, useState } from 'react';
import type { AvailableWorlds, SessionResponse } from '@arbestra/contracts';
import { getSession, getWorlds, joinWorld, login, logout, register } from './api/client';

const WORLD_CLIENT_URL = import.meta.env.VITE_WORLD_CLIENT_URL ?? `${window.location.protocol}//${window.location.hostname}:5174`;
function worldUrl(slug: string, villageId?: string): string {
  const url = new URL(WORLD_CLIENT_URL.replace('{world}', encodeURIComponent(slug)), window.location.href);
  if (!WORLD_CLIENT_URL.includes('{world}')) url.searchParams.set('world', slug);
  if (villageId) url.searchParams.set('villageId', villageId);
  return url.href;
}
export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login'|'register'>('login');
  const [worlds, setWorlds] = useState<AvailableWorlds | null>(null), [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => { void getSession().then(setSession).catch(()=>setError('Le serveur est momentanément inaccessible.')).finally(()=>setLoading(false)); }, []);
  useEffect(() => {
    if (!session) { setWorlds(null); setChosen(null); return; }
    let live=true;
    void getWorlds().then(value=>{if(live)setWorlds(value);}).catch(()=>{if(live)setError('Les mondes sont momentanément inaccessibles.');});
    return ()=>{live=false;};
  }, [session]);
  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(pending)return; setError(null);
    const form = new FormData(event.currentTarget), email=String(form.get('email')).trim(), password=String(form.get('password'));
    if(authMode==='register'&&password!==form.get('confirmation')) {setError('Les mots de passe ne correspondent pas.');return;}
    setPending(true);
    try {setSession(await (authMode==='register'?register:login)({email,password}));}
    catch(reason){setError(reason instanceof Error?reason.message:'Connexion impossible.');}
    finally{setPending(false);}
  }
  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending||!chosen)return;setPending(true);setError(null);
    const form=new FormData(event.currentTarget);
    try {
      if(worlds?.find(w=>w.slug===chosen)?.spawnMode==='atlas'){const url=new URL(worldUrl(chosen));url.pathname='/spawn-map';url.searchParams.set('playerName',String(form.get('playerName')).trim());url.searchParams.set('villageName',String(form.get('villageName')).trim());window.location.assign(url.href);return;}
      const result=await joinWorld(chosen,{playerName:String(form.get('playerName')).trim(),villageName:String(form.get('villageName')).trim()});
      window.location.assign(worldUrl(chosen,result.villageId));
    }catch(reason){setError(reason instanceof Error?reason.message:'Impossible de créer le village.');setPending(false);}
  }
  async function handleLogout() {
    if(pending)return;setPending(true);setError(null);
    try {await logout();setSession(null);}
    catch(reason){setError(reason instanceof Error?reason.message:'Déconnexion impossible.');}
    finally{setPending(false);}
  }
  return <main className="lobby-shell"><section className="lobby-card" aria-busy={loading||pending}>
    <p className="eyebrow">Arbestra</p>
    <h1>{session?'Votre aventure commence':authMode==='register'?'Créer votre compte':'Entrer dans le monde'}</h1>
    {loading&&<p>Chargement de la session…</p>}
    {!loading&&!session&&<>
      <div className="auth-tabs" role="group" aria-label="Accès au jeu">
        <button type="button" className={authMode==='login'?'':'quiet-button'} aria-pressed={authMode==='login'} disabled={pending} onClick={()=>{setAuthMode('login');setError(null);}}>Connexion</button>
        <button type="button" className={authMode==='register'?'':'quiet-button'} aria-pressed={authMode==='register'} disabled={pending} onClick={()=>{setAuthMode('register');setError(null);}}>S’inscrire</button>
      </div>
      <form className="login-form" onSubmit={event=>void handleAuth(event)} key={authMode}>
        <label>Adresse e-mail<input name="email" type="email" maxLength={320} autoComplete="username" required disabled={pending}
          defaultValue={authMode==='login'&&import.meta.env.DEV?'player@arbestra.local':''}/></label>
        <label>Mot de passe<input name="password" type="password" minLength={authMode==='register'?8:1} maxLength={authMode==='register'?128:1024}
          autoComplete={authMode==='register'?'new-password':'current-password'} required disabled={pending}
          defaultValue={authMode==='login'&&import.meta.env.DEV?'arbestra':''}/></label>
        {authMode==='register'&&<><small>Au moins 8 caractères.</small><label>Confirmer le mot de passe<input name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending}/></label></>}
        <button type="submit" disabled={pending}>{pending?'Connexion en cours…':authMode==='register'?'Créer mon compte':'Se connecter'}</button>
      </form>
    </>}
    {session&&<div className="world-list">
      {session.worlds.length>0&&<><h2>Retrouver votre village</h2>{session.worlds.map(world=>
        <a className="world-card" href={worldUrl(world.slug)} key={world.id}><strong>{world.name}</strong><span>Jouer en tant que {world.playerName}</span></a>)}</>}
      <h2>Choisir un monde</h2><p className="onboarding-intro">Un village vous attend. Choisissez votre monde et donnez-lui un nom.</p>
      {!worlds&&<p>Chargement des mondes…</p>}
      {worlds?.filter(w=>!w.joined).map(world=><button className="world-card" type="button" key={world.slug} disabled={pending||!world.canJoin} aria-pressed={chosen===world.slug}
        onClick={()=>{setChosen(world.slug);setError(null);}}><strong>{world.name}</strong><span>{world.canJoin?'Fonder votre village':'Ce monde est complet'}</span></button>)}
      {worlds&&worlds.every(w=>w.joined)&&<p>{session.worlds.length?'Vous avez déjà rejoint les mondes disponibles.':'Aucun monde n’est ouvert pour le moment.'}</p>}
      {chosen&&<form className="login-form join-form" onSubmit={event=>void handleJoin(event)}>
        <label>Nom du personnage<input name="playerName" required maxLength={40} pattern={'.*\\S.*'} disabled={pending}/></label>
        <label>Nom du village<input name="villageName" required maxLength={60} pattern={'.*\\S.*'} disabled={pending}/></label>
        <button type="submit" disabled={pending}>{pending?'Préparation de votre village…':'Commencer l’aventure'}</button>
        <small>Votre progression sera sauvegardée dans ce monde.</small>
      </form>}
      <button className="quiet-button" type="button" disabled={pending} onClick={()=>void handleLogout()}>Se déconnecter</button>
    </div>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section></main>;
}
