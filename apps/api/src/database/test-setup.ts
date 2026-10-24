// Vitest setup file: importing test-environment loads .env.test first.
import './test-environment.js';
import { useWorkerDatabase } from './test-workers.js';

useWorkerDatabase();
