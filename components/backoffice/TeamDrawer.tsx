'use client';

import { useState } from 'react';
import { X, Edit2, Trash2, Users, Calendar, User, Briefcase, CheckCircle, AlertCircle } from 'lucide-react';
import { Team } from '@/types/users';
import { mockUsers } from '@/lib/mockUsers';
import DeleteConfirmationModal from './DeleteConfirmationModal';

type TeamDrawerProps = {
  team: Team | null;
  onClose: () => void;
  onEdit: (team: Team) => void;
  onDelete: (teamId: string) => void;
};

type TabType = 'details' | 'members' | 'history';

export default function TeamDrawer({ team, onClose, onEdit, onDelete }: TeamDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  if (!team) return null;

  // Buscar informações adicionais
  const manager = mockUsers.find(u => u.id === team.manager_id);
  const createdBy = mockUsers.find(u => u.id === team.created_by);

  const handleDelete = () => {
    onDelete(team.id);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[700px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-2 bg-white">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="font-display font-bold text-xl text-neutral-10 truncate">
                {team.name}
              </h2>
              {!team.is_active && (
                <span className="px-2 py-1 bg-neutral-2 text-neutral-5 text-xs font-medium rounded">
                  Inativo
                </span>
              )}
            </div>
            {team.description && (
              <p className="text-sm text-neutral-8 line-clamp-2">
                {team.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => onEdit(team)}
              className="p-2 text-neutral-8 hover:bg-neutral-1 rounded-lg transition-colors"
              title="Editar"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="p-2 text-neutral-8 hover:bg-red-50 hover:text-suno-red rounded-lg transition-colors"
              title="Excluir"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-neutral-8 hover:bg-neutral-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 border-b border-neutral-2 bg-white">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'details'
                ? 'text-suno-red border-b-2 border-suno-red'
                : 'text-neutral-8 hover:text-neutral-10'
            }`}
          >
            Detalhes
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'members'
                ? 'text-suno-red border-b-2 border-suno-red'
                : 'text-neutral-8 hover:text-neutral-10'
            }`}
          >
            Membros ({team.member_count})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-suno-red border-b-2 border-suno-red'
                : 'text-neutral-8 hover:text-neutral-10'
            }`}
          >
            Histórico
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-neutral-1">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Manager */}
              {manager && (
                <div className="bg-white rounded-lg border border-neutral-2 p-5">
                  <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-4">
                    Manager do Time
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-neutral-2 rounded-full flex items-center justify-center">
                      <User className="w-6 h-6 text-neutral-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-neutral-10">
                        {manager.full_name}
                      </p>
                      <p className="text-sm text-neutral-8">
                        {manager.department || 'Sem departamento'}
                      </p>
                      <p className="text-xs text-neutral-5 font-mono mt-1">
                        {manager.email_prefix}@suno.com.br
                      </p>
                    </div>
                    <span className="px-3 py-1.5 bg-neutral-1 text-neutral-8 text-xs font-medium rounded-lg">
                      {manager.role === 'admin' ? 'Admin' : 'Manager'}
                    </span>
                  </div>
                </div>
              )}

              {/* Informações Básicas */}
              <div className="bg-white rounded-lg border border-neutral-2 p-5">
                <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-4">
                  Informações Básicas
                </p>
                <div className="space-y-4">
                  {team.department && (
                    <div className="flex items-start gap-3">
                      <Briefcase className="w-5 h-5 text-neutral-5 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-neutral-5 mb-1">Departamento</p>
                        <p className="text-sm text-neutral-10">
                          {team.department}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <Users className="w-5 h-5 text-neutral-5 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs text-neutral-5 mb-1">Total de Membros</p>
                      <p className="text-sm text-neutral-10">
                        {team.member_count} {team.member_count === 1 ? 'membro' : 'membros'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-neutral-5 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs text-neutral-5 mb-1">Criado em</p>
                      <p className="text-sm text-neutral-10">
                        {new Date(team.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </p>
                      {createdBy && (
                        <p className="text-xs text-neutral-8 mt-1">
                          por {createdBy.full_name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status do Book */}
              <div className="bg-white rounded-lg border border-neutral-2 p-5">
                <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-4">
                  Book de Indicadores
                </p>
                <div className="flex items-center gap-3 p-3 bg-neutral-1 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-neutral-10">
                      Book de Time
                    </p>
                    <p className="text-xs text-neutral-8 mt-0.5">
                      Time compartilha book de indicadores
                    </p>
                  </div>
                </div>
              </div>

              {/* Warning sobre membros */}
              {team.member_count > 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-700 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 mb-1">
                        Atenção ao excluir este time
                      </p>
                      <p className="text-xs text-yellow-700">
                        Os {team.member_count} membros deste time ficarão sem book de indicadores 
                        até serem realocados para outro time ou receberem um book individual.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              {team.members.length === 0 ? (
                <div className="bg-white rounded-lg border border-neutral-2 p-12 text-center">
                  <Users className="w-12 h-12 text-neutral-3 mx-auto mb-3" />
                  <p className="text-neutral-8 mb-2">Nenhum membro neste time</p>
                  <p className="text-sm text-neutral-5">
                    Adicione membros editando o time
                  </p>
                </div>
              ) : (
                team.members.map((member) => {
                  const memberUser = mockUsers.find(u => u.id === member.user_id);
                  return (
                    <div
                      key={member.user_id}
                      className="bg-white rounded-lg border border-neutral-2 p-5 hover:border-neutral-3 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-neutral-2 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-neutral-8" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-neutral-10">
                            {member.user_name}
                          </p>
                          {member.role_in_team && (
                            <p className="text-sm text-neutral-8 mt-0.5">
                              {member.role_in_team}
                            </p>
                          )}
                          {memberUser && (
                            <p className="text-xs text-neutral-5 font-mono mt-1">
                              {memberUser.email_prefix}@suno.com.br
                            </p>
                          )}
                        </div>
                        {memberUser && (
                          <span className="px-3 py-1.5 bg-neutral-1 text-neutral-8 text-xs font-medium rounded-lg">
                            {memberUser.department || 'Sem dept.'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="bg-white rounded-lg border border-neutral-2 p-8 text-center">
              <p className="text-neutral-8 mb-2">
                Histórico de alterações em desenvolvimento
              </p>
              <p className="text-sm text-neutral-5">
                Em breve você poderá ver o histórico completo de alterações do time
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Excluir Time"
        description="Esta ação não pode ser desfeita. O time será permanentemente removido."
        confirmText="EXCLUIR TIME"
        itemName={team.name}
        warningMessage={
          team.member_count > 0
            ? `Este time possui ${team.member_count} ${team.member_count === 1 ? 'membro' : 'membros'}. Eles ficarão sem book de indicadores até serem realocados.`
            : undefined
        }
      />
    </>
  );
}

