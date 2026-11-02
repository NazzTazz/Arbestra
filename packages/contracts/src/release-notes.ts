import type { Release } from './releases.js';

/**
 * Les nouveautés présentées au joueur (docs/SPEC-NOUVEAUTES-ORACLE.md).
 *
 * Une entrée par version `alpha-*`, la plus récente EN PREMIER : l'ordre de
 * ce tableau fait foi pour « plus récent que ». Au tag d'une alpha, ajouter
 * en tête une entrée dont l'`id` est exactement le nom du tag, avec 2 à 5
 * points (titre court, une phrase) dans la voix de l'Oracle : malicieuse,
 * brève, jamais technique. Ne jamais retirer ni renommer une entrée déjà
 * déployée : les comptes l'ont peut-être vue.
 */
export const RELEASE_NOTES: readonly Release[] = [
  {
    id: 'alpha-2026.11.02.1',
    date: '2026-11-02',
    items: [
      {
        title: 'Le défrichage a pris de la vitesse',
        text: 'Un habitant vient à bout d’une souche en une minute. Les racines ont fini par comprendre qu’il ne lâcherait pas.',
      },
      {
        title: 'Des nouvelles plus vives',
        text: 'Vos ordres, vos récoltes et vos expéditions se répercutent plus vite : j’ai cessé de faire patienter les messagers dans l’antichambre.',
      },
      {
        title: 'Un marché qui se tient au courant',
        text: 'La liste des offres se met à jour toute seule. Inutile de rouvrir la fenêtre pour apprendre que quelqu’un a acheté avant vous.',
      },
      {
        title: 'Quand le village ne répond plus',
        text: 'Si le silence dure environ une minute, je vous le dis et je vous propose de réessayer ; si votre page est trop ancienne, je vous demande de la recharger.',
      },
      {
        title: 'Cette fenêtre',
        text: 'Désormais, je vous raconte ce qui change à chaque nouvelle version. Vous pouvez me remercier, mais sans insister.',
      },
    ],
  },
];
