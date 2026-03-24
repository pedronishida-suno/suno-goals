import { NextRequest, NextResponse } from 'next/server';
import { getTeamById, updateTeam, deleteTeam } from '@/lib/services/users';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const team = await getTeamById(id);
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(team);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const updated = await updateTeam(id, body);
  if (!updated) return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deleteTeam(id);
  if (!ok) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  return NextResponse.json({ success: true });
}
