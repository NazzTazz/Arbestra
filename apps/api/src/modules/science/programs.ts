import type { ScienceDiscipline } from '@arbestra/contracts';

export type Mastery = Record<ScienceDiscipline, number>;
export interface ProgramDefinition {
  code: string; discipline: ScienceDiscipline; level: number; title: string; description: string;
  workRequiredMs: number; prerequisites: Partial<Mastery>; spontaneous: boolean;
  evidence: 'none' | 'surveys' | 'solar';
}
const minutes = (n: number) => n * 60_000;
/** Initial product balancing, approved for the first human recipe. */
export const UNIVERSITY_CAPACITIES = [
  { level: 1, centres: 1, workers: 5 }, { level: 2, centres: 2, workers: 10 }, { level: 3, centres: 3, workers: 15 },
] as const;
export const CARTOGRAPHER_TRAINING_MS = minutes(10);
export const SCIENCE_PROGRAMS: readonly ProgramDefinition[] = [
  { code: 'mathematics-1', discipline: 'mathematics', level: 1, title: 'Quantifier', description: 'Comparer des quantités, des distances et des durées.',
    workRequiredMs: minutes(10), prerequisites: {}, spontaneous: false, evidence: 'none' },
  { code: 'geography-1', discipline: 'geography', level: 1, title: 'Relever le terrain', description: 'Former des cartographes et reconnaître des accès au-delà du village.',
    workRequiredMs: minutes(10), prerequisites: {}, spontaneous: false, evidence: 'none' },
  { code: 'mathematics-2', discipline: 'mathematics', level: 2, title: 'Mesurer l’espace', description: 'Angles, distances et mesures comparables pour les relevés.',
    workRequiredMs: minutes(20), prerequisites: { mathematics: 1 }, spontaneous: false, evidence: 'none' },
  { code: 'geography-2', discipline: 'geography', level: 2, title: 'Explorer et cartographier', description: 'Confronter les relevés et organiser des expéditions de reconnaissance.',
    workRequiredMs: minutes(20), prerequisites: { geography: 1, mathematics: 2 }, spontaneous: false, evidence: 'surveys' },
  { code: 'mathematics-3', discipline: 'mathematics', level: 3, title: 'Modéliser les cycles', description: 'Mettre à l’épreuve un modèle à partir de mesures de plusieurs lieux.',
    workRequiredMs: minutes(40), prerequisites: { mathematics: 2 }, spontaneous: false, evidence: 'surveys' },
  { code: 'astronomy-1', discipline: 'astronomy', level: 1, title: 'Comprendre le ciel', description: 'Les habitants rapportent des rythmes lumineux inhabituels. Les chercheurs cherchent une explication.',
    workRequiredMs: minutes(30), prerequisites: { mathematics: 3, geography: 2 }, spontaneous: true, evidence: 'solar' },
];

export function prerequisitesMet(program: ProgramDefinition, levels: Mastery): boolean {
  return Object.entries(program.prerequisites).every(([discipline, level]) => levels[discipline as ScienceDiscipline] >= level!);
}

/** Reveal the next mastery in a known discipline, never the entire future tree. */
export function programVisible(program: ProgramDefinition, levels: Mastery): boolean {
  return program.level <= levels[program.discipline] + 1 && (program.discipline !== 'astronomy'
    || levels.mathematics >= 3 && levels.geography >= 2 || levels.astronomy >= 1);
}

/** This presentation coefficient grants nothing. The astronomy threshold is explicit. */
export function knowledgeProfile(levels: Mastery, surveyedPlaces: number) {
  const globalModelAvailable = levels.astronomy >= 1;
  const scientific = (Math.min(3, levels.mathematics) + Math.min(2, levels.geography) + Math.min(1, levels.astronomy)) / 6;
  return { globalModelAvailable, knowledgeCoefficient: Math.min(1, scientific * .8 + Math.min(1, surveyedPlaces / 20) * .2) };
}
