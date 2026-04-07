import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mondayGraphQL } from '@/lib/services/monday';

/**
 * GET /api/monday/introspect?boardId=<id>
 *
 * Discovery utility — returns all column definitions + 3 sample items for any
 * Monday.com board. Use this to find column IDs for MONDAY_COL_BOOKS and
 * MONDAY_COL_COLABORADORES in lib/services/monday.ts.
 *
 * Protected: admin session or service-role bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
  }

  // ── Parse boardId ───────────────────────────────────────────────────────────
  const boardIdParam = request.nextUrl.searchParams.get('boardId');
  if (!boardIdParam) {
    return NextResponse.json(
      { error: 'Missing required query param: boardId' },
      { status: 400 }
    );
  }
  const boardId = Number(boardIdParam);
  if (!Number.isFinite(boardId) || boardId <= 0) {
    return NextResponse.json(
      { error: `Invalid boardId: "${boardIdParam}"` },
      { status: 400 }
    );
  }

  // ── GraphQL — fetch columns + 3 sample items ────────────────────────────────
  const query = `
    query {
      boards(ids: [${boardId}]) {
        name
        columns {
          id
          title
          type
        }
        items_page(limit: 3) {
          items {
            id
            name
            column_values {
              id
              title
              type
              text
              value
            }
          }
        }
      }
    }
  `;

  type IntrospectData = {
    boards: Array<{
      name: string;
      columns: Array<{ id: string; title: string; type: string }>;
      items_page: {
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{
            id: string;
            title: string;
            type: string;
            text: string | null;
            value: string | null;
          }>;
        }>;
      };
    }>;
  };

  let data: IntrospectData;
  try {
    data = await mondayGraphQL<IntrospectData>(query);
  } catch (err) {
    return NextResponse.json(
      { error: `Monday.com API error: ${String(err)}` },
      { status: 502 }
    );
  }

  const board = data.boards[0];
  if (!board) {
    return NextResponse.json(
      { error: `Board ${boardId} not found or not accessible` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    board_id:     boardId,
    board_name:   board.name,
    columns:      board.columns,
    sample_items: board.items_page.items,
  });
}
