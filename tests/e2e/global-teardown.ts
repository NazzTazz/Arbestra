import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

export default async function globalTeardown() {
  await resetE2eState();
}
