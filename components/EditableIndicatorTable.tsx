'use client';

import { useState } from 'react';
import { BookData, IndicatorType, MonthData } from '@/types/indicator';
import IndicatorTable from './IndicatorTable';

type EditableIndicatorTableProps = {
  initialData: BookData;
  year?: number;
};

export default function EditableIndicatorTable({ initialData, year }: EditableIndicatorTableProps) {
  const [bookData, setBookData] = useState<BookData>(initialData);

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

  return <IndicatorTable data={bookData} onCellUpdate={handleCellUpdate} />;
}
