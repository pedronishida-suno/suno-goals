import { getIndicators } from '@/lib/services/indicators';
import IndicatorsClient from './IndicatorsClient';

export default async function IndicatorsPage() {
  const indicators = await getIndicators();
  return <IndicatorsClient initialIndicators={indicators} />;
}
