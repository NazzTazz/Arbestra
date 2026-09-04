import { fileURLToPath } from 'node:url';

import { createDatabase } from './connection.js';
import { seedDevelopmentData } from './seed.js';
import { testDatabaseUrl } from './test-environment.js';

export async function resetE2eState(databaseUrl = testDatabaseUrl()): Promise<void> {
  testDatabaseUrl({ TEST_DATABASE_URL: databaseUrl });
  const db = createDatabase(databaseUrl);
  try {
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('sessions').execute();
      await transaction.deleteFrom('scheduledTasks').execute();
      await transaction.deleteFrom('worlds').execute();
    });
    await seedDevelopmentData(databaseUrl);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await resetE2eState();
  console.info('E2E state reset.');
}
