import { migrateToLatest } from './migrate.js';
import { testDatabaseUrl } from './test-environment.js';

await migrateToLatest(testDatabaseUrl());
