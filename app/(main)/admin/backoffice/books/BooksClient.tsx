'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Filter, X } from 'lucide-react';
import { BackofficeBook, BookFilters } from '@/types/backoffice';
import BookCard from '@/components/backoffice/BookCard';
import BookDrawer from '@/components/backoffice/BookDrawer';

interface Props {
  initialBooks: BackofficeBook[];
}

export default function BooksClient({ initialBooks }: Props) {
  const router = useRouter();
  const [books, setBooks] = useState<BackofficeBook[]>(initialBooks);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<BookFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedBook, setSelectedBook] = useState<BackofficeBook | null>(null);

  const filteredBooks = books.filter(book => {
    if (searchTerm &&
        !book.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !book.owner.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (filters.year && book.year !== filters.year) return false;
    if (filters.owner_type && filters.owner_type.length > 0 &&
        !filters.owner_type.includes(book.owner.type)) {
      return false;
    }
    if (filters.is_active !== undefined && book.is_active !== filters.is_active) return false;
    if (filters.has_missing_goals && book.indicators_with_missing_goals === 0) return false;
    if (filters.performance_level && filters.performance_level.length > 0 &&
        book.performance_level &&
        !filters.performance_level.includes(book.performance_level)) {
      return false;
    }
    return true;
  });

  const booksWithAlerts = books.filter(
    b => b.indicators_with_missing_goals > 0 || b.performance_level === 'critical'
  ).length;

  const activeFiltersCount =
    (filters.year ? 1 : 0) +
    (filters.owner_type?.length || 0) +
    (filters.is_active !== undefined ? 1 : 0) +
    (filters.has_missing_goals ? 1 : 0) +
    (filters.performance_level?.length || 0);

  const handleEditBook = async (book: BackofficeBook) => {
    setBooks(prev => prev.map(b => b.id === book.id ? book : b));
    setSelectedBook(book);

    await fetch(`/api/books/${book.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: book.name, description: book.description }),
    });
    router.refresh();
  };

  const handleDeleteBook = async (id: string) => {
    setBooks(prev => prev.filter(b => b.id !== id));
    setSelectedBook(null);

    await fetch(`/api/books/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl text-neutral-10 mb-1">
            Books
          </h1>
          <p className="text-sm text-neutral-8">
            {filteredBooks.length} de {books.length} books
            {booksWithAlerts > 0 && (
              <span className="ml-2 text-suno-red">
                • {booksWithAlerts} com alertas
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push('/admin/backoffice/books/new')}
          className="flex items-center gap-2 px-4 py-2.5 bg-suno-red text-white font-semibold text-sm rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Book
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-5" />
          <input
            type="text"
            placeholder="Buscar por nome, pessoa ou time..."
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

      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilters({ ...filters, has_missing_goals: !filters.has_missing_goals })}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            filters.has_missing_goals
              ? 'bg-suno-red text-white'
              : 'bg-neutral-1 text-neutral-8 hover:bg-neutral-2'
          }`}
        >
          Sem metas ({books.filter(b => b.indicators_with_missing_goals > 0).length})
        </button>
        <button
          onClick={() => {
            const hasFilter = filters.performance_level?.includes('critical');
            setFilters({ ...filters, performance_level: hasFilter ? [] : ['critical'] });
          }}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            filters.performance_level?.includes('critical')
              ? 'bg-suno-red text-white'
              : 'bg-neutral-1 text-neutral-8 hover:bg-neutral-2'
          }`}
        >
          Performance crítica ({books.filter(b => b.performance_level === 'critical').length})
        </button>
        <button
          onClick={() => setFilters({ ...filters, is_active: filters.is_active === false ? undefined : false })}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            filters.is_active === false
              ? 'bg-suno-red text-white'
              : 'bg-neutral-1 text-neutral-8 hover:bg-neutral-2'
          }`}
        >
          Inativos ({books.filter(b => !b.is_active).length})
        </button>
      </div>

      {/* Books Grid */}
      {filteredBooks.length === 0 ? (
        <div className="bg-white border border-neutral-2 rounded-xl p-12 text-center">
          <p className="text-neutral-8 mb-2">Nenhum book encontrado</p>
          <p className="text-sm text-neutral-5">
            {searchTerm || activeFiltersCount > 0
              ? 'Tente ajustar os filtros de busca'
              : 'Crie seu primeiro book para começar'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => setSelectedBook(book)}
            />
          ))}
        </div>
      )}

      {selectedBook && (
        <BookDrawer
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onEdit={handleEditBook}
          onDelete={handleDeleteBook}
        />
      )}
    </div>
  );
}
