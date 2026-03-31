'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check } from 'lucide-react';
import BookWizardStep1 from '@/components/backoffice/book-wizard-v2/BookWizardStep1';
import BookWizardStep2 from '@/components/backoffice/book-wizard-v2/BookWizardStep2';
import BookWizardStep3 from '@/components/backoffice/book-wizard-v2/BookWizardStep3';
import { BookOwnerType, MonthlyGoals } from '@/types/backoffice';

type BookFormData = {
  name: string;
  year: number;
  owner_type: BookOwnerType;
  owner_id: string;
  owner_name: string;
  owner_email?: string;
  owner_role?: string;
  description?: string;
  selected_indicators: {
    indicator_id: string;
    indicator_name: string;
    indicator_format: any;
    indicator_direction: 'up' | 'down';
    goals: MonthlyGoals;
  }[];
};

export default function NewBookPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<BookFormData>({
    name: '',
    year: 2025,
    owner_type: 'person',
    owner_id: '',
    owner_name: '',
    owner_email: undefined,
    owner_role: undefined,
    description: '',
    selected_indicators: [],
  });

  const steps = [
    { number: 1, title: 'Responsável', subtitle: 'Quem será o dono deste book?' },
    { number: 2, title: 'Indicadores', subtitle: 'Escolha de 1 a 6 indicadores' },
    { number: 3, title: 'Finalizar', subtitle: 'Revise e confirme' },
  ];

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.owner_id && formData.owner_name && formData.name;
      case 2:
        return formData.selected_indicators.length >= 1 && formData.selected_indicators.length <= 6;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 3 && canProceed()) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = () => {
    if (confirm('Deseja realmente cancelar? Todas as alterações não salvas serão perdidas.')) {
      router.push('/admin/backoffice/books');
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        owner_id: formData.owner_id,
        year: formData.year,
        indicator_ids: formData.selected_indicators.map(i => i.indicator_id),
        goals_by_indicator: Object.fromEntries(
          formData.selected_indicators.map(i => [i.indicator_id, i.goals])
        ),
      };

      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(`Erro ao criar book: ${data.error ?? res.statusText}`);
        return;
      }

      router.push('/admin/backoffice/books');
    } catch {
      alert('Falha na conexão com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-end">
      {/* Sidebar Wizard */}
      <div className="w-full max-w-2xl h-full bg-white flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 px-8 py-6 border-b border-neutral-2">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="font-display font-bold text-2xl text-neutral-10 mb-1">
                Criar Novo Book
              </h1>
              <p className="text-sm text-neutral-8">
                {steps[currentStep - 1].subtitle}
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 text-neutral-8 hover:bg-neutral-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Progress Steps - Horizontal */}
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                      currentStep === step.number
                        ? 'bg-suno-red text-white scale-110'
                        : currentStep > step.number
                        ? 'bg-green-600 text-white'
                        : 'bg-neutral-2 text-neutral-5'
                    }`}
                  >
                    {currentStep > step.number ? <Check className="w-5 h-5" /> : step.number}
                  </div>
                  <div className="hidden md:block flex-1">
                    <p
                      className={`text-xs font-semibold ${
                        currentStep === step.number ? 'text-neutral-10' : 'text-neutral-5'
                      }`}
                    >
                      {step.title}
                    </p>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 w-full mx-2 transition-colors ${
                      currentStep > step.number ? 'bg-green-600' : 'bg-neutral-2'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {currentStep === 1 && <BookWizardStep1 formData={formData} setFormData={setFormData} />}
          {currentStep === 2 && <BookWizardStep2 formData={formData} setFormData={setFormData} />}
          {currentStep === 3 && <BookWizardStep3 formData={formData} />}
        </div>

        {/* Footer - Fixed */}
        <div className="flex-shrink-0 px-8 py-4 border-t border-neutral-2 bg-neutral-1">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBack}
              disabled={currentStep === 1}
              className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${
                currentStep === 1
                  ? 'text-neutral-4 cursor-not-allowed'
                  : 'text-neutral-10 hover:bg-neutral-2'
              }`}
            >
              Voltar
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCancel}
                className="px-5 py-2.5 text-neutral-8 hover:bg-neutral-2 rounded-lg transition-colors font-medium"
              >
                Cancelar
              </button>

              {currentStep === 3 ? (
                <button
                  onClick={handleSubmit}
                  disabled={!canProceed() || isSubmitting}
                  className={`px-8 py-2.5 rounded-lg font-semibold transition-all ${
                    canProceed() && !isSubmitting
                      ? 'bg-suno-red text-white hover:bg-red-700 shadow-sm'
                      : 'bg-neutral-3 text-neutral-5 cursor-not-allowed'
                  }`}
                >
                  {isSubmitting ? 'Criando...' : 'Criar Book'}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className={`px-8 py-2.5 rounded-lg font-semibold transition-all ${
                    canProceed()
                      ? 'bg-suno-red text-white hover:bg-red-700 shadow-sm'
                      : 'bg-neutral-3 text-neutral-5 cursor-not-allowed'
                  }`}
                >
                  Continuar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
