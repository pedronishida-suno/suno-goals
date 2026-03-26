import { BackofficeIndicator } from '@/types/backoffice';
import { TrendingUp, TrendingDown, BookOpen, AlertCircle, CheckCircle, Clock } from 'lucide-react';

type IndicatorCardProps = {
  indicator: BackofficeIndicator;
  onClick: () => void;
};

const formatIcons = {
  percentage: '%',
  number: '#',
  currency: 'R$',
  boolean: '✓',
  hours: 'H',
};

const statusConfig = {
  validated: { label: 'Validado', icon: CheckCircle, color: 'text-neutral-8' },
  in_construction: { label: 'Em Construção', icon: Clock, color: 'text-neutral-5' },
  under_review: { label: 'Em Revisão', icon: AlertCircle, color: 'text-suno-red' },
};

export default function IndicatorCard({ indicator, onClick }: IndicatorCardProps) {
  const StatusIcon = statusConfig[indicator.status].icon;
  const DirectionIcon = indicator.direction === 'up' ? TrendingUp : TrendingDown;

  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-neutral-2 rounded-xl p-4 hover:border-neutral-5 hover:shadow-sm transition-all text-left"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-sm text-neutral-10 mb-1 truncate">
            {indicator.name}
          </h3>
          <p className="text-xs text-neutral-8 line-clamp-2">
            {indicator.description}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-bold text-neutral-5">
            {formatIcons[indicator.format]}
          </span>
          <DirectionIcon className="w-3.5 h-3.5 text-neutral-5" />
        </div>
      </div>

      {/* Tags */}
      {indicator.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {indicator.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="px-2 py-0.5 bg-neutral-1 text-neutral-8 text-xs font-medium rounded"
              style={{ borderLeft: `3px solid ${tag.color}` }}
            >
              {tag.name}
            </span>
          ))}
          {indicator.tags.length > 3 && (
            <span className="px-2 py-0.5 bg-neutral-1 text-neutral-5 text-xs font-medium rounded">
              +{indicator.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-neutral-2">
        <div className="flex items-center gap-3">
          {/* Status */}
          <div className="flex items-center gap-1">
            <StatusIcon className={`w-3.5 h-3.5 ${statusConfig[indicator.status].color}`} />
            <span className="text-xs text-neutral-8">
              {statusConfig[indicator.status].label}
            </span>
          </div>

          {/* Books */}
          {(indicator.total_books || 0) > 0 && (
            <div className="flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-neutral-5" />
              <span className="text-xs text-neutral-8">
                {indicator.total_books}
              </span>
            </div>
          )}
        </div>

        {/* Achievement */}
        {(indicator.average_achievement || 0) > 0 && (
          <span className={`text-xs font-bold ${
            (indicator.average_achievement ?? 0) >= 100 ? 'text-neutral-10' : 'text-suno-red'
          }`}>
            {indicator.average_achievement}%
          </span>
        )}
      </div>
    </button>
  );
}

