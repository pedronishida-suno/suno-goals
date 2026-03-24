import { NextRequest, NextResponse } from 'next/server';
import { getUsers, createUser } from '@/lib/services/users';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filters = {
    search: searchParams.get('search') ?? undefined,
    role: searchParams.getAll('role') as never[] | undefined,
    status: searchParams.getAll('status') as never[] | undefined,
  };

  const users = await getUsers(filters);
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const newUser = await createUser(body, user.id);
  if (!newUser) return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });

  return NextResponse.json(newUser, { status: 201 });
}
