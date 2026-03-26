import { TeamBook, Notification, MacroIndicators, IndicatorType } from '@/types/indicator';

/**
 * Calcula se um indicador está batendo a meta
 */
function isIndicatorAchieving(indicator: IndicatorType): boolean {
  const { percentage } = indicator.accumulated;
  const { direction } = indicator;

  if (percentage === 0) return false;

  if (direction === 'up') {
    return percentage >= 100;
  } else {
    return percentage <= 100;
  }
}

/**
 * Calcula os indicadores macro de todos os books
 */
export function calculateMacroIndicators(books: TeamBook[]): MacroIndicators {
  let totalIndicators = 0;
  let achieving = 0;
  let notAchieving = 0;

  books.forEach(book => {
    book.data.indicators.forEach(indicator => {
      totalIndicators++;
      
      if (isIndicatorAchieving(indicator)) {
        achieving++;
      } else {
        notAchieving++;
      }
    });
  });

  const achievementRate = totalIndicators > 0 
    ? Math.round((achieving / totalIndicators) * 100) 
    : 0;

  return {
    totalIndicators,
    achieving,
    notAchieving,
    achievementRate,
  };
}

/**
 * Verifica se um book está desatualizado
 * Considera desatualizado se o mês anterior não tem dados após o 5º dia útil
 */
function isBookOutdated(book: TeamBook): boolean {
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11
  const currentDay = now.getDate();
  
  // Se não temos a data de última atualização, consideramos desatualizado
  if (!book.lastUpdate) {
    return true;
  }
  
  // Verifica se já passou do 5º dia útil do mês
  // Simplificação: considera 5º dia corrido (em produção, calcular dias úteis)
  if (currentDay < 5) {
    return false; // Ainda não passou do prazo
  }
  
  // Pega o mês anterior
  const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  
  // Mapeia índice do mês para chave
  const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const previousMonthKey = monthKeys[previousMonth] as keyof IndicatorType['months'];
  
  // Verifica se algum indicador tem dados do mês anterior
  const hasDataForPreviousMonth = book.data.indicators.some(indicator => {
    const monthData = indicator.months[previousMonthKey];
    return monthData.real !== 0 || monthData.percentage !== 0;
  });
  
  return !hasDataForPreviousMonth;
}

/**
 * Verifica se um owner tem book
 * (Para simular, vamos considerar que alguns owners podem não ter book)
 */
function hasMissingBook(book: TeamBook): boolean {
  // Verifica se o book tem pelo menos um indicador
  return book.data.indicators.length === 0;
}

/**
 * Gera notificações para books com problemas
 */
export function generateNotifications(books: TeamBook[], allOwners?: string[]): Notification[] {
  const notifications: Notification[] = [];
  
  // Verifica books desatualizados
  books.forEach(book => {
    if (isBookOutdated(book)) {
      notifications.push({
        id: `outdated-${book.id}`,
        type: 'outdated_book',
        message: 'Book desatualizado (mês anterior sem dados)',
        ownerName: book.owner.name,
        severity: 'warning',
      });
    }
    
    // Verifica books sem indicadores
    if (hasMissingBook(book)) {
      notifications.push({
        id: `missing-${book.id}`,
        type: 'missing_book',
        message: 'Book sem indicadores cadastrados',
        ownerName: book.owner.name,
        severity: 'error',
      });
    }
  });
  
  // Se temos lista de owners esperados, verifica quem não tem book
  if (allOwners) {
    const ownersWithBooks = new Set(books.map(b => b.owner.id));
    allOwners.forEach(ownerId => {
      if (!ownersWithBooks.has(ownerId)) {
        notifications.push({
          id: `no-book-${ownerId}`,
          type: 'missing_book',
          message: 'Sem book cadastrado',
          ownerName: ownerId, // Em produção, buscar nome real
          severity: 'error',
        });
      }
    });
  }
  
  return notifications;
}

