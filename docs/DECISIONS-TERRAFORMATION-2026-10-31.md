# Terraformation — décisions du 31 octobre 2026

Décisions de Tristan (validées), qui remplacent le chantier de nivellement (villageois, durée, devis) pour la terraformation libre **et** le nivellement sous l'emprise d'un bâtiment (« Niveler le sol »).

1. **Instantanée et gratuite dans tous les cas** : pas de villageois, pas de durée, pas de coût, pas de confirmation.
2. **Annuler, modèle A (délai côté client)** : chaque geste s'ajoute à un lot en attente, montré en aperçu ; un bouton **Annuler** et un décompte de **10 s** depuis le **dernier** geste — chaque nouveau geste remet le minuteur à 10 s. Au terme, le lot part au serveur et s'applique immédiatement ; **Annuler** abandonne tout le lot. Même modèle que la démolition.
3. Le serveur applique les hauteurs à l'admission de la commande (plus de `leveling_jobs` pour les nouveaux gestes).

Reste à spécifier : sort des chantiers de nivellement déjà en cours, ordre d'application des gestes d'un lot, limites par lot.
