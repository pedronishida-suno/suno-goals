import { NextRequest, NextResponse } from 'next/server';
import { getIndicators, createIndicator } from '@/lib/services/indicators';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const filters = {
    search: searchParams.get('search') ?? undefined,
    status: searchParams.getAll('status') as never[] | undefined,
    format: searchParams.getAll('format') as never[] | undefined,
    tags: searchParams.getAll('tags') ?? undefined,
    has_books: searchParams.has('has_books')
      ? searchParams.get('has_books') === 'true'
      : undefined,
  };

  const indicators = await getIndicators(filters);
  return NextResponse.json(indicators);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const indicator = await createIndicator(body, user.id);

  if (!indicator) {
    return NextResponse.json({ error: 'Failed to create indicator' }, { status: 500 });
  }

  return NextResponse.json(indicator, { status: 201 });
}
