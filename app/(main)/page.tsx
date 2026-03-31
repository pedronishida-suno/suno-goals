import Header from '@/components/Header';
import EditableIndicatorTable from '@/components/EditableIndicatorTable';
import TeamBooksSection from '@/components/TeamBooksSection';
import { getCurrentUser } from '@/lib/auth/utils';
import { getDashboardData } from '@/lib/services/dashboard';

export default async function Home() {
  const currentYear = new Date().getFullYear();

  let myBook = null;
  let teamBooks: import('@/types/indicator').TeamBook[] = [];
  let collaboratorName: string | undefined;

  try {
    const user = await getCurrentUser();
    if (user) {
      collaboratorName = user.full_name ?? undefined;
      const data = await getDashboardData(user.id, currentYear);
      myBook = data.myBook;
      teamBooks = data.teamBooks;
    }
  } catch {
    // Supabase not configured or session error — show empty state
  }

  return (
    <div className="bg-white">
      <div className="w-full max-w-[1800px] mx-auto px-2 sm:px-4">
        <Header
          currentYear={currentYear}
          collaboratorName={collaboratorName}
        />

        {myBook ? (
          <div className="print:m-0" data-indicator-table>
            <EditableIndicatorTable initialData={myBook} year={currentYear} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-neutral-5 text-lg mb-2">Nenhum book encontrado para {currentYear}</p>
            <p className="text-neutral-4 text-sm">
              Solicite ao administrador a criação do seu book de indicadores.
            </p>
          </div>
        )}

        {teamBooks.length > 0 && (
          <TeamBooksSection books={teamBooks} />
        )}

        <div className="mt-8 md:mt-10 lg:mt-12 text-center text-xs md:text-sm text-neutral-5 print:mt-4">
          Suno Goals © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
