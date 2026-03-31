// 🚧 DESENVOLVIMENTO: Autenticação desabilitada
// TODO: Habilitar autenticação em produção

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Em desenvolvimento, permite acesso direto
  // Em produção, descomentar o código abaixo:
  
  /*
  import { redirect } from 'next/navigation';
  import { getCurrentUser, isAdmin } from '@/lib/auth/utils';
  
  const user = await getCurrentUser();
  const admin = await isAdmin();

  if (!user) {
    redirect('/login');
  }

  if (!admin) {
    redirect('/unauthorized');
  }
  */

  return <>{children}</>;
}

