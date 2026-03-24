import { getUsers } from '@/lib/services/users';
import UsersClient from './UsersClient';

export default async function UsersPage() {
  const users = await getUsers();
  return <UsersClient initialUsers={users} />;
}
