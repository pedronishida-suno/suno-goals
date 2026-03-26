import {
  Users,
  TrendingUp,
  BookOpen,
  AlertCircle,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export default async function BackofficeDashboard() {
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  const { data: userData } = authUser
    ? await supabase.from('users').select('full_name, email').eq('id', authUser.id).single()
    : { data: null };

  const user = userData ?? { full_name: 'Admin', email: '' };

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [
    { count: totalUsers },
    { count: totalIndicators },
    { count: totalBooks },
    { data: achievementData },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('backoffice_indicators').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('books').select('*', { count: 'exact', head: true }).eq('year', currentYear).eq('is_active', true),
    supabase
      .from('indicator_data')
      .select('indicator_id, meta, real')
      .eq('year', currentYear)
      .eq('month', currentMonth)
      .not('meta', 'is', null)
      .not('real', 'is', null),
  ]);

  const achieving = (achievementData ?? []).filter(r => Number(r.real) >= Number(r.meta)).length;
  const notAchieving = (achievementData ?? []).filter(r => Number(r.real) < Number(r.meta)).length;

  const stats = {
    totalUsers: totalUsers ?? 0,
    totalIndicators: totalIndicators ?? 0,
    totalBooks: totalBooks ?? 0,
    outdatedBooks: 0,
    achievingIndicators: achieving,
    notAchievingIndicators: notAchieving,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl md:text-3xl text-neutral-10 mb-2">
          Dashboard
        </h1>
        <p className="text-neutral-8">
          Bem-vindo, <span className="font-semibold">{user?.full_name}</span>
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Total Users */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-neutral-2 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-neutral-8" />
            </div>
            <span className="text-xs font-medium text-neutral-5">Total</span>
          </div>
          <div className="text-2xl font-bold text-neutral-10 mb-1">
            {stats.totalUsers}
          </div>
          <div className="text-sm text-neutral-8">Usuários</div>
        </div>

        {/* Total Indicators */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-neutral-2 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-neutral-8" />
            </div>
            <span className="text-xs font-medium text-neutral-5">Total</span>
          </div>
          <div className="text-2xl font-bold text-neutral-10 mb-1">
            {stats.totalIndicators}
          </div>
          <div className="text-sm text-neutral-8">Indicadores</div>
        </div>

        {/* Total Books */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-neutral-2 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-neutral-8" />
            </div>
            <span className="text-xs font-medium text-neutral-5">Total</span>
          </div>
          <div className="text-2xl font-bold text-neutral-10 mb-1">
            {stats.totalBooks}
          </div>
          <div className="text-sm text-neutral-8">Books</div>
        </div>

        {/* Achieving Indicators */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-neutral-2 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-neutral-8" />
            </div>
            <span className="text-xs font-medium text-neutral-8">
              {Math.round((stats.achievingIndicators / stats.totalIndicators) * 100)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-neutral-10 mb-1">
            {stats.achievingIndicators}
          </div>
          <div className="text-sm text-neutral-8">Batendo Meta</div>
        </div>

        {/* Not Achieving Indicators */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <XCircle className="w-5 h-5 text-suno-red" />
            </div>
            <span className="text-xs font-medium text-suno-red">
              {Math.round((stats.notAchievingIndicators / stats.totalIndicators) * 100)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-suno-red mb-1">
            {stats.notAchievingIndicators}
          </div>
          <div className="text-sm text-neutral-8">Abaixo da Meta</div>
        </div>

        {/* Outdated Books */}
        <div className="bg-white border border-neutral-2 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-suno-red" />
            </div>
            <span className="text-xs font-medium text-suno-red">Atenção</span>
          </div>
          <div className="text-2xl font-bold text-suno-red mb-1">
            {stats.outdatedBooks}
          </div>
          <div className="text-sm text-neutral-8">Books Desatualizados</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white border border-neutral-2 rounded-xl p-5">
        <h2 className="font-display font-semibold text-lg text-neutral-10 mb-4">
          Ações Rápidas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <a
            href="/admin/backoffice/users"
            className="flex items-center gap-3 p-3 rounded-lg border border-neutral-2 hover:border-suno-red hover:bg-red-50 transition-colors"
          >
            <Users className="w-5 h-5 text-suno-red" />
            <span className="text-sm font-medium text-neutral-10">Gerenciar Usuários</span>
          </a>
          <a
            href="/admin/backoffice/indicators"
            className="flex items-center gap-3 p-3 rounded-lg border border-neutral-2 hover:border-suno-red hover:bg-red-50 transition-colors"
          >
            <TrendingUp className="w-5 h-5 text-suno-red" />
            <span className="text-sm font-medium text-neutral-10">Gerenciar Indicadores</span>
          </a>
          <a
            href="/admin/backoffice/books"
            className="flex items-center gap-3 p-3 rounded-lg border border-neutral-2 hover:border-suno-red hover:bg-red-50 transition-colors"
          >
            <BookOpen className="w-5 h-5 text-suno-red" />
            <span className="text-sm font-medium text-neutral-10">Gerenciar Books</span>
          </a>
          <a
            href="/admin/backoffice/settings"
            className="flex items-center gap-3 p-3 rounded-lg border border-neutral-2 hover:border-suno-red hover:bg-red-50 transition-colors"
          >
            <AlertCircle className="w-5 h-5 text-suno-red" />
            <span className="text-sm font-medium text-neutral-10">Ver Alertas</span>
          </a>
        </div>
      </div>
    </div>
  );
}

