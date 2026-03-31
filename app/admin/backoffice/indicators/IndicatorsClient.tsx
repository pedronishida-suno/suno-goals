'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Filter, X, Users } from 'lucide-react';
import { BackofficeIndicator, IndicatorFilters } from '@/types/backoffice';
import type { MondayPerson } from '@/app/api/monday/people/route';
import IndicatorCard from '@/components/backoffice/IndicatorCard';
import IndicatorDrawer from '@/components/backoffice/IndicatorDrawer';
import IndicatorFormModal from '@/components/backoffice/IndicatorFormModal';
import IndicatorFiltersPanel from '@/components/backoffice/IndicatorFiltersPanel';
import DeleteConfirmationModal from '@/components/backoffice/DeleteConfirmationModal';

interface Props {
  initialIndicators: BackofficeIndicator[];
}

export default function IndicatorsClient({ initialIndicators }: Props) {
  const router = useRouter();
  const [indicators, setIndicators] = useState<BackofficeIndicator[]>(initialIndicators);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<IndicatorFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [people, setPeople] = useState<MondayPerson[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [showPeople, setShowPeople] = useState(false);

  useEffect(() => {
    fetch('/api/monday/people')
      .then(r => r.json())
      .then((data: MondayPerson[]) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);
  const [selectedIndicator, setSelectedIndicator] = useState<BackofficeIndicator | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingIndicator, setEditingIndicator] = useState<BackofficeIndicator | null>(null);
  const [indicatorToDelete, setIndicatorToDelete] = useState<{ id: string; name: string } | null>(null);

  const filteredIndicators = indicators.filter(indicator => {
    if (selectedPersonId !== null) {
      const hasPerson = (indicator.responsible_people ?? []).some(p => p.id === selectedPersonId);
      if (!hasPerson) return false;
    }
    if (searchTerm && !indicator.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !indicator.description.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (filters.status && filters.status.length > 0 && !filters.status.includes(indicator.status)) {
      return false;
    }
    if (filters.format && filters.format.length > 0 && !filters.format.includes(indicator.format)) {
      return false;
    }
    if (filters.tags && filters.tags.length > 0) {
      const indicatorTagIds = indicator.tags.map(t => t.id);
      const hasTag = filters.tags.some(tagId => indicatorTagIds.includes(tagId));
      if (!hasTag) return false;
    }
    if (filters.has_books !== undefined) {
      const hasBooks = (indicator.total_books || 0) > 0;
      if (filters.has_books !== hasBooks) return false;
    }
    return true;
  });

  const handleCreateIndicator = () => {
    setEditingIndicator(null);
    setShowForm(true);
  };

  const handleEditIndicator = async (indicator: BackofficeIndicator) => {
    // Optimistic update
    setIndicators(prev => prev.map(i => i.id === indicator.id ? indicator : i));
    setSelectedIndicator(indicator);

    // Persist to Supabase
    await fetch(`/api/indicators/${indicator.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: indicator.name,
        description: indicator.description,
        notes: indicator.notes,
        format: indicator.format,
        direction: indicator.direction,
        status: indicator.status,
        aggregation_type: indicator.aggregation_type,
        tag_ids: indicator.tags.map(t => t.id),
      }),
    });

    router.refresh();
  };

  const handleSaveIndicator = async (indicator: BackofficeIndicator) => {
    // Optimistic update with temp id
    const tempId = `temp-${Date.now()}`;
    const tempIndicator = { ...indicator, id: tempId };
    setIndicators(prev => [tempIndicator, ...prev]);
    setShowForm(false);
    setEditingIndicator(null);

    // Persist to Supabase
    const response = await fetch('/api/indicators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: indicator.name,
        description: indicator.description,
        notes: indicator.notes,
        format: indicator.format,
        direction: indicator.direction,
        status: indicator.status,
        aggregation_type: indicator.aggregation_type,
        tag_ids: indicator.tags.map(t => t.id),
      }),
    });

    if (response.ok) {
      const created: BackofficeIndicator = await response.json();
      // Replace temp with real
      setIndicators(prev => prev.map(i => i.id === tempId ? created : i));
    } else {
      // Rollback
      setIndicators(prev => prev.filter(i => i.id !== tempId));
    }

    router.refresh();
  };

  const handleDeleteIndicator = (id: string, name: string) => {
    setIndicatorToDelete({ id, name });
  };

  const handleConfirmDeleteIndicator = async () => {
    if (!indicatorToDelete) return;

    // Optimistic update
    setIndicators(prev => prev.filter(i => i.id !== indicatorToDelete.id));
    setSelectedIndicator(null);
    setIndicatorToDelete(null);

    await fetch(`/api/indicators/${indicatorToDelete.id}`, { method: 'DELETE' });
    router.refresh();
  };

  const activeFiltersCount =
    (filters.status?.length || 0) +
    (filters.format?.length || 0) +
    (filters.tags?.length || 0) +
    (filters.has_books !== undefined ? 1 : 0);

  const selectedPerson = people.find(p => p.id === selectedPersonId) ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl text-neutral-10 mb-1">
            Indicadores
          </h1>
          <p className="text-sm text-neutral-8">
            {filteredIndicators.length} de {indicators.length} indicadores
          </p>
        </div>
        <button
          onClick={handleCreateIndicator}
          className="flex items-center gap-2 px-4 py-2.5 bg-suno-red text-white font-semibold text-sm rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Indicador
        </button>
      </div>

      {/* Person Selector */}
      {people.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowPeople(!showPeople)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg font-medium text-sm transition-colors ${
              selectedPersonId !== null
                ? 'border-suno-red bg-red-50 text-suno-red'
                : 'border-neutral-3 bg-white text-neutral-10 hover:border-neutral-5'
            }`}
          >
            <Users className="w-4 h-4" />
            {selectedPerson ? selectedPerson.name : 'Ver por pessoa'}
            {selectedPersonId !== null && (
              <span
                onClick={(e) => { e.stopPropagation(); setSelectedPersonId(null); }}
                className="ml-1 hover:opacity-70"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </button>
          {showPeople && (
            <div className="absolute z-20 top-full left-0 mt-1 w-72 bg-white border border-neutral-3 rounded-xl shadow-lg max-h-72 overflow-y-auto">
              <div className="p-2">
                {people.map(person => (
                  <button
                    key={person.id}
                    onClick={() => { setSelectedPersonId(person.id); setShowPeople(false); }}
                    className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-neutral-1 transition-colors ${
                      selectedPersonId === person.id ? 'bg-red-50 text-suno-red font-medium' : 'text-neutral-10'
                    }`}
                  >
                    <span>{person.name}</span>
                    <span className="text-xs text-neutral-5">{person.indicator_count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-5" />
          <input
            type="text"
            placeholder="Buscar por nome ou descrição..."
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

      {showFilters && (
        <IndicatorFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}

      {filteredIndicators.length === 0 ? (
        <div className="bg-white border border-neutral-2 rounded-xl p-12 text-center">
          <p className="text-neutral-8 mb-2">Nenhum indicador encontrado</p>
          <p className="text-sm text-neutral-5">
            {searchTerm || activeFiltersCount > 0
              ? 'Tente ajustar os filtros de busca'
              : 'Crie seu primeiro indicador para começar'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredIndicators.map((indicator) => (
            <IndicatorCard
              key={indicator.id}
              indicator={indicator}
              onClick={() => setSelectedIndicator(indicator)}
            />
          ))}
        </div>
      )}

      {selectedIndicator && (
        <IndicatorDrawer
          indicator={selectedIndicator}
          onClose={() => setSelectedIndicator(null)}
          onEdit={handleEditIndicator}
          onDelete={handleDeleteIndicator}
        />
      )}

      {showForm && (
        <IndicatorFormModal
          indicator={editingIndicator}
          onSave={handleSaveIndicator}
          onClose={() => {
            setShowForm(false);
            setEditingIndicator(null);
          }}
        />
      )}

      <DeleteConfirmationModal
        isOpen={indicatorToDelete !== null}
        onClose={() => setIndicatorToDelete(null)}
        onConfirm={handleConfirmDeleteIndicator}
        title="Excluir Indicador"
        description="Esta ação é irreversível. O indicador será removido permanentemente do sistema."
        confirmText="EXCLUIR O INDICADOR"
        itemName={indicatorToDelete?.name}
        warningMessage={
          indicators.find(i => i.id === indicatorToDelete?.id)?.total_books
            ? `Este indicador está em ${indicators.find(i => i.id === indicatorToDelete?.id)?.total_books} book(s). Todos serão afetados.`
            : undefined
        }
      />
    </div>
  );
}
