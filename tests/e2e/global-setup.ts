import { migrateToLatest } from '../../apps/api/src/database/migrate';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';

export default async function globalSetup() {
  const databaseUrl = testDatabaseUrl();
  await migrateToLatest(databaseUrl);
  await resetE2eState(databaseUrl);
}
