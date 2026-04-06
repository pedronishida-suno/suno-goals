import { NextRequest, NextResponse } from 'next/server';
import { resendInvite } from '@/lib/services/users';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ok = await resendInvite(id);
  if (!ok) return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 });

  return NextResponse.json({ success: true });
}
