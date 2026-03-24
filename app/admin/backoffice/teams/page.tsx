import { getTeams } from '@/lib/services/users';
import TeamsClient from './TeamsClient';

export default async function TeamsPage() {
  const teams = await getTeams();
  return <TeamsClient initialTeams={teams} />;
}
