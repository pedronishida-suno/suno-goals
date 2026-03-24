import { NextRequest, NextResponse } from 'next/server';
import { getUserById, updateUser, deactivateUser } from '@/lib/services/users';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getUserById(id);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(user);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const updated = await updateUser(id, body);
  if (!updated) return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deactivateUser(id);
  if (!ok) return NextResponse.json({ error: 'Failed to deactivate' }, { status: 500 });
  return NextResponse.json({ success: true });
}
