import type { RepresentativeInfo } from '../scene/village-workers';
import type { InhabitantCameraMode } from '../scene/inhabitant-camera';

export function RepresentativePanel({person,view,onView,onClose}:{person:RepresentativeInfo;view:InhabitantCameraMode;
  onView:(mode:'pov'|'follow'|'village')=>void;onClose:()=>void}) {
  return <section className="representative-panel" aria-label="Habitant sélectionné">
    <header><strong>{person.name}</strong><button type="button" onClick={onClose} aria-label="Fermer la fiche de l’habitant">×</button></header>
    <small>{person.cohortSize!==null?`${person.cohortSize} habitants`:'Habitant'}</small>
    <dl>
      <dt>Énergie</dt><dd>{person.energy!==null?`${person.energy} / 10`:'Non renseignée'}</dd>
      <dt>Qualifications</dt><dd>{person.qualifications.join(' · ')}</dd>
      <dt>Mode</dt><dd>{person.mode}</dd>
      <dt>Destination</dt><dd>{person.destination}</dd>
    </dl>
    <div className="representative-camera-actions">
      <button type="button" aria-pressed={view==='pov'} onClick={()=>onView('pov')}>Voir en POV</button>
      <button type="button" aria-pressed={view==='follow'} onClick={()=>onView('follow')}>Bloquer caméra</button>
      {view!=='village'&&<button type="button" onClick={()=>onView('village')}>Revenir à la vue village</button>}
    </div>
    <p>{view==='free'?'Marche libre · ZQSD · glisser pour regarder · Échap pour revenir':view==='pov'?'Vue de l’habitant · ZQSD pour marcher librement':view==='follow'?'Caméra attachée à l’habitant · Échap pour revenir':'L’habitant poursuit son activité pendant la sélection.'}</p>
  </section>;
}
