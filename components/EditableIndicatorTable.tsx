'use client';

import { useState, useMemo } from 'react';
import { BookData, IndicatorTag, IndicatorType, MonthData } from '@/types/indicator';
import IndicatorTable from './IndicatorTable';

type EditableIndicatorTableProps = {
  initialData: BookData;
  year?: number;
};

export default function EditableIndicatorTable({ initialData, year }: EditableIndicatorTableProps) {
  const [bookData, setBookData] = useState<BookData>(initialData);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  // Extract unique 'type' tags from all indicators
  const typeTags = useMemo<IndicatorTag[]>(() => {
    const seen = new Map<string, IndicatorTag>();
    for (const ind of bookData.indicators) {
      for (const tag of ind.tags ?? []) {
        if (tag.category === 'type' && !seen.has(tag.id)) {
          seen.set(tag.id, tag);
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [bookData.indicators]);

  // Filter indicators by active tag
  const filteredIndicators = useMemo(() => {
    if (!activeTagId) return bookData.indicators;
    return bookData.indicators.filter((ind) =>
      ind.tags?.some((t) => t.id === activeTagId)
    );
  }, [bookData.indicators, activeTagId]);

  // Summary stats for the filtered set
  const summary = useMemo(() => {
    const total = filteredIndicators.length;
    const achieving = filteredIndicators.filter(
      (i) => i.accumulated.meta > 0 && i.accumulated.percentage >= 100
    ).length;
    const withData = filteredIndicators.filter((i) => i.accumulated.real > 0).length;
    const avgPct =
      withData > 0
        ? Math.round(
            filteredIndicators
              .filter((i) => i.accumulated.real > 0)
              .reduce((s, i) => s + i.accumulated.percentage, 0) / withData
          )
        : 0;
    return { total, achieving, withData, avgPct };
  }, [filteredIndicators]);

  const filteredBookData: BookData = { ...bookData, indicators: filteredIndicators };

  const calculatePercentage = (real: number, meta: number): number => {
    if (meta === 0) return 0;
    return Math.round((real / meta) * 100);
  };

  const recalculateAccumulated = (indicator: IndicatorType): MonthData => {
    const months = Object.values(indicator.months);
    const totalMeta = months.reduce((sum, month) => sum + month.meta, 0);
    const totalReal = months.reduce((sum, month) => sum + month.real, 0);
    return {
      meta: totalMeta,
      real: totalReal,
      percentage: calculatePercentage(totalReal, totalMeta),
    };
  };

  const handleCellUpdate = (
    indicatorId: string,
    monthKey: keyof IndicatorType['months'],
    newRealValue: number
  ) => {
    setBookData((prevData) => {
      const updatedIndicators = prevData.indicators.map((indicator) => {
        if (indicator.id !== indicatorId) return indicator;

        const meta = indicator.months[monthKey].meta;
        const percentage = calculatePercentage(newRealValue, meta);

        const updatedMonths = {
          ...indicator.months,
          [monthKey]: { ...indicator.months[monthKey], real: newRealValue, percentage },
        };

        const updatedIndicator = { ...indicator, months: updatedMonths };
        updatedIndicator.accumulated = recalculateAccumulated(updatedIndicator);
        return updatedIndicator;
      });

      return { ...prevData, indicators: updatedIndicators };
    });

    // Persist to database (fire-and-forget)
    if (year) {
      const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const;
      const month = (MONTH_KEYS as readonly string[]).indexOf(monthKey) + 1;
      if (month > 0) {
        fetch('/api/indicator-data/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indicator_id: indicatorId, year, month, real: newRealValue }),
        }).catch(() => { /* silent fail — UI already updated optimistically */ });
      }
    }
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Summary + Filter chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        {/* Achievement summary pills */}
        {summary.withData > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-neutral-5">
              {summary.total} indicador{summary.total !== 1 ? 'es' : ''}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              {summary.achieving} na meta
            </span>
            {summary.avgPct > 0 && (
              <span className="text-xs text-neutral-5">{summary.avgPct}% médio</span>
            )}
          </div>
        )}

        {/* Type tag filter chips */}
        {typeTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveTagId(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeTagId === null
                  ? 'bg-suno-red text-white'
                  : 'bg-neutral-1 text-neutral-8 hover:bg-neutral-2'
              }`}
            >
              Todos
            </button>
            {typeTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeTagId === tag.id
                    ? 'bg-suno-red text-white'
                    : 'bg-neutral-1 text-neutral-8 hover:bg-neutral-2'
                }`}
                style={
                  activeTagId !== tag.id && tag.color
                    ? { borderLeft: `3px solid ${tag.color}` }
                    : undefined
                }
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Indicator table */}
      {filteredIndicators.length === 0 ? (
        <p className="text-sm text-neutral-5 py-4 text-center">
          Nenhum indicador encontrado para este filtro.
        </p>
      ) : (
        <IndicatorTable data={filteredBookData} onCellUpdate={handleCellUpdate} />
      )}
    </div>
  );
}
