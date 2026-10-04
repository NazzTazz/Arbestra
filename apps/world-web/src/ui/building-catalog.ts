/** Presentation metadata, never an authorization or an economic rule. */
export const BUILDING_PRESENTATIONS: Record<string, { footprint: string; purpose: string }> = {
  dwelling: { footprint: '1 × 1 case', purpose: 'Accueille les habitants et leur offre un couchage.' },
  'town-hall': { footprint: '1 × 2 cases', purpose: 'Cœur administratif du village.' },
  garden: { footprint: 'Zone tracée', purpose: 'Cultive les carottes ; une tournée récolte les parcelles.' },
  sawmill: { footprint: '1 × 1 case', purpose: 'Produit du bois pour développer le village.' },
  university: { footprint: '5 × 6 cases', purpose: 'Recherche, formations et découverte du monde.' },
  barracks: { footprint: '2 × 5 cases', purpose: 'Cour d’entraînement et pavillons militaires.' },
};
