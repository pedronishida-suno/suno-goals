import { NextRequest, NextResponse } from 'next/server';
import { getBooks, createBook } from '@/lib/services/books';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const books = await getBooks();
  return NextResponse.json(books);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const book = await createBook(body, user.id);
  if (!book) return NextResponse.json({ error: 'Failed to create book' }, { status: 500 });

  return NextResponse.json(book, { status: 201 });
}
