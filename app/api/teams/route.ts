import { NextRequest, NextResponse } from 'next/server';
import { getTeams, createTeam } from '@/lib/services/users';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const teams = await getTeams();
  return NextResponse.json(teams);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const team = await createTeam(body, user.id);
  if (!team) return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });

  return NextResponse.json(team, { status: 201 });
}
