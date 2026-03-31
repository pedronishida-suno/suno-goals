'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Filter, X, Users as UsersIcon, User as UserIcon } from 'lucide-react';
import { Team, TeamFilters, TeamFormData } from '@/types/users';
import TeamFormModal from '@/components/backoffice/TeamFormModal';
import TeamDrawer from '@/components/backoffice/TeamDrawer';

interface Props {
  initialTeams: Team[];
}

export default function TeamsClient({ initialTeams }: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TeamFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const handleSaveTeam = async (teamData: TeamFormData) => {
    setShowTeamModal(false);
    setEditingTeam(null);

    if (editingTeam) {
      const response = await fetch(`/api/teams/${editingTeam.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamData),
      });
      if (response.ok) {
        const updated: Team = await response.json();
        setTeams(prev => prev.map(t => t.id === editingTeam.id ? updated : t));
      }
    } else {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamData),
      });
      if (response.ok) {
        const created: Team = await response.json();
        setTeams(prev => [created, ...prev]);
      }
    }

    router.refresh();
  };

  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setSelectedTeam(null);
    setShowTeamModal(true);
  };

  const handleDeleteTeam = async (teamId: string) => {
    setTeams(prev => prev.filter(t => t.id !== teamId));
    await fetch(`/api/teams/${teamId}`, { method: 'DELETE' });
    router.refresh();
  };

  const filteredTeams = teams.filter(team => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (
        !team.name.toLowerCase().includes(search) &&
        !team.manager_name.toLowerCase().includes(search) &&
        !team.department?.toLowerCase().includes(search)
      ) {
        return false;
      }
    }
    if (filters.is_active !== undefined && team.is_active !== filters.is_active) return false;
    if (filters.min_members && team.member_count < filters.min_members) return false;
    if (filters.max_members && team.member_count > filters.max_members) return false;
    return true;
  });

  const stats = {
    total: teams.length,
    active: teams.filter(t => t.is_active).length,
    inactive: teams.filter(t => !t.is_active).length,
    total_members: teams.reduce((acc, t) => acc + t.member_count, 0),
  };

  const activeFiltersCount =
    (filters.is_active !== undefined ? 1 : 0) +
    (filters.min_members ? 1 : 0) +
    (filters.max_members ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl text-neutral-10 mb-1">
            Times
          </h1>
          <p className="text-sm text-neutral-8">
            {filteredTeams.length} times • {stats.total_members} membros
          </p>
        </div>
        <button
          onClick={() => setShowTeamModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-suno-red text-white font-semibold text-sm rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Time
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-neutral-2 rounded-lg p-4">
          <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-1">Times Ativos</p>
          <p className="text-2xl font-bold text-neutral-10">{stats.active}</p>
        </div>
        <div className="bg-white border border-neutral-2 rounded-lg p-4">
          <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-1">Total de Membros</p>
          <p className="text-2xl font-bold text-neutral-10">{stats.total_members}</p>
        </div>
        <div className="bg-white border border-neutral-2 rounded-lg p-4">
          <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-1">Média por Time</p>
          <p className="text-2xl font-bold text-neutral-10">
            {stats.total > 0 ? (stats.total_members / stats.total).toFixed(1) : 0}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-5" />
          <input
            type="text"
            placeholder="Buscar por nome, manager ou departamento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-neutral-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-suno-red focus:border-suno-red text-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-5 hover:text-neutral-10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg font-medium text-sm transition-colors ${
            showFilters || activeFiltersCount > 0
              ? 'border-suno-red bg-red-50 text-suno-red'
              : 'border-neutral-3 bg-white text-neutral-10 hover:border-neutral-5'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtros
          {activeFiltersCount > 0 && (
            <span className="px-1.5 py-0.5 bg-suno-red text-white text-xs font-bold rounded-full">
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Teams Grid */}
      {filteredTeams.length === 0 ? (
        <div className="bg-white border border-neutral-2 rounded-xl p-12 text-center">
          <UsersIcon className="w-12 h-12 text-neutral-3 mx-auto mb-3" />
          <p className="text-neutral-8 mb-2">Nenhum time encontrado</p>
          <p className="text-sm text-neutral-5">
            {searchTerm || activeFiltersCount > 0
              ? 'Tente ajustar os filtros de busca'
              : 'Crie seu primeiro time para começar'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeam(team)}
              className="bg-white border border-neutral-2 rounded-xl p-5 text-left hover:border-neutral-5 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-semibold text-lg text-neutral-10 mb-1 truncate">
                    {team.name}
                  </h3>
                  {team.description && (
                    <p className="text-sm text-neutral-8 line-clamp-2">{team.description}</p>
                  )}
                </div>
                {!team.is_active && (
                  <span className="px-2 py-1 bg-neutral-2 text-neutral-5 text-xs font-medium rounded ml-2">
                    Inativo
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-neutral-2">
                <div className="w-8 h-8 bg-neutral-2 rounded-full flex items-center justify-center">
                  <UserIcon className="w-4 h-4 text-neutral-8" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-neutral-5">Manager</p>
                  <p className="text-sm font-medium text-neutral-10 truncate">{team.manager_name}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide">
                    Membros ({team.member_count})
                  </p>
                  {team.department && (
                    <span className="text-xs text-neutral-5">{team.department}</span>
                  )}
                </div>
                {team.members.length > 0 && (
                  <div className="space-y-2">
                    {team.members.slice(0, 3).map((member) => (
                      <div key={member.user_id} className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-neutral-1 rounded-full flex items-center justify-center">
                          <UserIcon className="w-3 h-3 text-neutral-8" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-neutral-10 truncate">{member.user_name}</p>
                        </div>
                        {member.role_in_team && (
                          <span className="text-xs text-neutral-5">{member.role_in_team}</span>
                        )}
                      </div>
                    ))}
                    {team.members.length > 3 && (
                      <p className="text-xs text-neutral-5 pl-8">
                        +{team.members.length - 3} membros
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-neutral-1 flex items-center justify-between text-xs text-neutral-5">
                <span>Criado em {new Date(team.created_at).toLocaleDateString('pt-BR')}</span>
                <span>por {team.created_by_name}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <TeamFormModal
        isOpen={showTeamModal}
        onClose={() => { setShowTeamModal(false); setEditingTeam(null); }}
        onSave={handleSaveTeam}
        team={editingTeam || undefined}
      />

      <TeamDrawer
        team={selectedTeam}
        onClose={() => setSelectedTeam(null)}
        onEdit={handleEditTeam}
        onDelete={handleDeleteTeam}
      />
    </div>
  );
}
