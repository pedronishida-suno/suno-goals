import { NextRequest, NextResponse } from 'next/server';
import { getIndicatorById, updateIndicator, deleteIndicator } from '@/lib/services/indicators';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const indicator = await getIndicatorById(id);
  if (!indicator) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(indicator);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const indicator = await updateIndicator(id, body);
  if (!indicator) return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  return NextResponse.json(indicator);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deleteIndicator(id);
  if (!ok) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  return NextResponse.json({ success: true });
}
