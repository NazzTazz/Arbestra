# Illustrations du HUD

PNG transparents 420 × 315, intégrés au projet le 20 octobre 2026. Génération avec l’outil intégré ImageGen, puis réduction proportionnelle et centrage sur un canevas transparent. Aucun appel ImageGen à l’exécution.

Direction commune des prompts : miniature de jeu médiéval, illustration isométrique douce, volumes low-poly, adultes en tuniques aux couleurs terre, éclairage chaleureux, sujet lisible à petite taille, sans texte ni interface, fond transparent. L’illustration de coupe approuvée sert de référence de style pour les autres groupes.

| Fichier | Sujet du prompt |
| --- | --- |
| `woodcutters.png` | Chantier de coupe avec bûcherons, arbres, troncs et outils. |
| `stonecutters.png` | Chantier de roche avec carriers, blocs de pierre et outils, assorti aux bûcherons. |
| `resting.png` | Deux habitants se reposant sur une couche de paille. |
| `idle.png` | Une femme et un homme disponibles, debout, sans tâche engagée. |
| `working.png` | Deux habitants en activité, portant un panier et une caisse à outils. |

Les aperçus conversationnels restent dans `test-results/hud-exploitation/`, ignoré par Git. Les illustrations de coupe et de roche sont conservées dans le HUD. Après le refus de recette du 20 octobre, Population reprend les figurines du jeu via `/thumbnails/workers-3.png` : les trois PNG `resting`, `idle`, `working` restent les propositions historiques, sans référence à l'exécution.

La miniature `/thumbnails/carrot.png` est un PNG transparent 384 × 240 capturé depuis `renderBuildingThumbnail('resource:carrot', 1)`, avec la recette 3D existante du marché, sans retouche. Population et marché partagent ces pixels précalculés : aucun nouveau moteur Babylon à lancer pour afficher les carottes. Refaire cette capture et incrémenter sa version dans `building-thumbnails.ts` si la recette ou ses matériaux changent.
