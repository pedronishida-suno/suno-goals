'use client';

import { useState } from 'react';
import { X, AlertCircle, Plus, Trash2, User } from 'lucide-react';
import { Team, TeamFormData } from '@/types/users';
import { mockUsers } from '@/lib/mockUsers';

type TeamFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (teamData: TeamFormData) => void;
  team?: Team; // Se fornecido, é edição
};

const departments = [
  'FP&A',
  'Tecnologia',
  'Dados e CRM',
  'Produtos',
  'Comercial',
  'Compliance',
  'Marketing',
  'Vendas',
  'Atendimento',
  'Financeiro',
  'Jurídico',
  'C&D',
];

export default function TeamFormModal({ isOpen, onClose, onSave, team }: TeamFormModalProps) {
  const [formData, setFormData] = useState<TeamFormData>({
    name: team?.name || '',
    description: team?.description || '',
    department: team?.department || '',
    manager_id: team?.manager_id || '',
    member_ids: team?.members.map((m) => m.user_id) || [],
  });

  const [errors, setErrors] = useState<Partial<Record<keyof TeamFormData, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof TeamFormData, boolean>>>({});
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberRole, setMemberRole] = useState('');

  // Managers disponíveis (admins e managers)
  const availableManagers = mockUsers.filter(u => 
    (u.role === 'admin' || u.role === 'manager') && u.id !== team?.id
  );

  // Usuários disponíveis para adicionar (não podem estar em outro time)
  const availableUsers = mockUsers.filter(u => {
    // Não pode estar em outro time
    if (u.team_id && u.team_id !== team?.id) return false;
    // Não pode ser o manager do time
    if (u.id === formData.manager_id) return false;
    // Não pode já estar na lista de membros
    if (formData.member_ids.includes(u.id)) return false;
    return true;
  });

  const handleChange = (field: keyof TeamFormData, value: string | string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setTouched(prev => ({ ...prev, [field]: true }));
    
    // Limpar erro ao digitar
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleAddMember = () => {
    if (!selectedUserId) return;
    handleChange('member_ids', [...formData.member_ids, selectedUserId]);
    setSelectedUserId('');
    setMemberRole('');
  };

  const handleRemoveMember = (userId: string) => {
    handleChange('member_ids', formData.member_ids.filter((id) => id !== userId));
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof TeamFormData, string>> = {};

    // Nome
    if (!formData.name.trim()) {
      newErrors.name = 'Nome do time é obrigatório';
    }

    // Manager
    if (!formData.manager_id) {
      newErrors.manager_id = 'Selecione um manager para o time';
    }

    // Membros (pelo menos 1)
    if (formData.member_ids.length === 0) {
      newErrors.member_ids = 'Adicione pelo menos 1 membro ao time';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Marcar todos como touched
    setTouched({
      name: true,
      description: true,
      department: true,
      manager_id: true,
      member_ids: true,
    });

    if (validate()) {
      onSave(formData);
      handleClose();
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      description: '',
      department: '',
      manager_id: '',
      member_ids: [],
    });
    setErrors({});
    setTouched({});
    setSelectedUserId('');
    setMemberRole('');
    onClose();
  };

  if (!isOpen) return null;

  const selectedManager = availableManagers.find(m => m.id === formData.manager_id);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-neutral-2">
            <div>
              <h2 className="font-display font-bold text-xl text-neutral-10">
                {team ? 'Editar Time' : 'Novo Time'}
              </h2>
              <p className="text-sm text-neutral-5 mt-1">
                {team ? 'Atualize as informações do time' : 'Preencha os dados para criar um novo time'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-neutral-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-neutral-8" />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
            <div className="space-y-5">
              {/* Nome do Time */}
              <div>
                <label className="block text-sm font-medium text-neutral-10 mb-2">
                  Nome do Time <span className="text-suno-red">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Ex: Time de Tecnologia"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                    touched.name && errors.name
                      ? 'border-suno-red focus:ring-red-200'
                      : 'border-neutral-3 focus:ring-suno-red focus:border-suno-red'
                  }`}
                />
                {touched.name && errors.name && (
                  <p className="text-xs text-suno-red mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-neutral-10 mb-2">
                  Descrição
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Ex: Time responsável pelo desenvolvimento de software"
                  rows={3}
                  className="w-full px-3 py-2 border border-neutral-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-suno-red focus:border-suno-red resize-none"
                />
              </div>

              {/* Manager e Departamento */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-10 mb-2">
                    Manager <span className="text-suno-red">*</span>
                  </label>
                  <select
                    value={formData.manager_id}
                    onChange={(e) => handleChange('manager_id', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                      touched.manager_id && errors.manager_id
                        ? 'border-suno-red focus:ring-red-200'
                        : 'border-neutral-3 focus:ring-suno-red focus:border-suno-red'
                    }`}
                  >
                    <option value="">Selecione...</option>
                    {availableManagers.map(manager => (
                      <option key={manager.id} value={manager.id}>
                        {manager.full_name} ({manager.role === 'admin' ? 'Admin' : 'Manager'})
                      </option>
                    ))}
                  </select>
                  {touched.manager_id && errors.manager_id && (
                    <p className="text-xs text-suno-red mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.manager_id}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-10 mb-2">
                    Departamento
                  </label>
                  <select
                    value={formData.department}
                    onChange={(e) => handleChange('department', e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-suno-red focus:border-suno-red"
                  >
                    <option value="">Selecione...</option>
                    {departments.map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview do Manager */}
              {selectedManager && (
                <div className="p-4 bg-neutral-1 rounded-lg border border-neutral-2">
                  <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-2">
                    Manager Selecionado
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-neutral-2 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-neutral-8" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-10">{selectedManager.full_name}</p>
                      <p className="text-sm text-neutral-8">
                        {selectedManager.department || 'Sem departamento'} • {selectedManager.role === 'admin' ? 'Admin' : 'Manager'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Adicionar Membros */}
              <div className="border border-neutral-2 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-medium text-neutral-10">
                      Membros do Time <span className="text-suno-red">*</span>
                    </p>
                    <p className="text-xs text-neutral-5 mt-0.5">
                      {formData.member_ids.length} {formData.member_ids.length === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                </div>

                {/* Form para adicionar membro */}
                <div className="bg-neutral-1 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-neutral-5 uppercase tracking-wide mb-3">
                    Adicionar Membro
                  </p>
                  <div className="grid grid-cols-[1fr,1fr,auto] gap-2">
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="px-3 py-2 border border-neutral-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-suno-red text-sm"
                    >
                      <option value="">Selecione um usuário...</option>
                      {availableUsers.map(user => (
                        <option key={user.id} value={user.id}>
                          {user.full_name} {user.department && `(${user.department})`}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value)}
                      placeholder="Role (opcional)"
                      className="px-3 py-2 border border-neutral-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-suno-red text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddMember}
                      disabled={!selectedUserId}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                        selectedUserId
                          ? 'bg-suno-red text-white hover:bg-red-700'
                          : 'bg-neutral-2 text-neutral-5 cursor-not-allowed'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar
                    </button>
                  </div>
                </div>

                {/* Lista de membros */}
                {formData.member_ids.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-neutral-5">Nenhum membro adicionado ainda</p>
                    {touched.member_ids && errors.member_ids && (
                      <p className="text-xs text-suno-red mt-2 flex items-center justify-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors.member_ids}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formData.member_ids.map((userId) => {
                      const user = mockUsers.find((u) => u.id === userId);
                      return (
                        <div
                          key={userId}
                          className="flex items-center justify-between p-3 bg-white border border-neutral-2 rounded-lg hover:border-neutral-3 transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-8 h-8 bg-neutral-1 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-neutral-8" />
                            </div>
                            <p className="text-sm font-medium text-neutral-10 truncate">
                              {user?.full_name ?? userId}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(userId)}
                            className="p-2 text-neutral-5 hover:text-suno-red hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Warning sobre books individuais */}
              {formData.member_ids.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    ⚠️ <strong>Importante:</strong> Membros de times não podem ter books individuais. 
                    Ao salvar, os books individuais desses usuários serão removidos.
                  </p>
                </div>
              )}
            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-neutral-2 bg-neutral-1">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-neutral-10 hover:bg-neutral-2 rounded-lg transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              className="px-6 py-2 bg-suno-red text-white font-semibold rounded-lg hover:bg-red-700 transition-colors"
            >
              {team ? 'Salvar Alterações' : 'Criar Time'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

