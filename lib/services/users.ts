import { createClient, createServiceClient } from '@/lib/supabase/server';
import type { User, Team, TeamMember, UserFilters, TeamFilters, UserFormData, TeamFormData, UserRole, UserStatus } from '@/types/users';

// =====================================================
// MAPPERS
// =====================================================

function rowToUser(row: Record<string, unknown>): User {
  const fullName = (row.full_name as string) ?? '';
  const parts = fullName.split(' ');
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  const emailPrefix = ((row.email as string) ?? '').split('@')[0];

  return {
    id: row.id as string,
    email_prefix: emailPrefix,
    full_email: row.email as string,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    role: (row.role as UserRole) ?? 'employee',
    department: row.department as string | undefined,
    status: (row.status as UserStatus) ?? 'pending',
    team_id: row.team_id as string | undefined,
    team_name: (row.team_name as string) ?? undefined,
    manager_id: row.manager_id as string | undefined,
    manager_name: (row.manager_name as string) ?? undefined,
    has_individual_book: !row.team_id,
    created_by: (row.created_by as string) ?? '',
    created_by_name: (row.created_by_name as string) ?? '',
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    last_login: row.last_login ? new Date(row.last_login as string) : undefined,
  };
}

function rowToTeam(row: Record<string, unknown>): Team {
  const members: TeamMember[] = ((row.members as Record<string, unknown>[]) ?? []).map((m) => ({
    user_id: m.user_id as string,
    user_name: (m.user_name as string) ?? '',
    user_email_prefix: ((m.user_email as string) ?? '').split('@')[0],
    role_in_team: m.role_in_team as string | undefined,
    joined_at: new Date(m.joined_at as string),
  }));

  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    manager_id: row.manager_id as string,
    manager_name: (row.manager_name as string) ?? '',
    department: row.department as string | undefined,
    members,
    member_count: members.length,
    is_active: (row.is_active as boolean) ?? true,
    created_by: (row.created_by as string) ?? '',
    created_by_name: (row.created_by_name as string) ?? '',
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

// =====================================================
// USERS
// =====================================================

export async function getUsers(filters?: UserFilters): Promise<User[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('users')
    .select(`
      *,
      manager:users!manager_id(full_name),
      team:teams!team_id(name)
    `)
    .order('full_name');

  if (error) {
    console.error('[getUsers]', error.message);
    return [];
  }

  let results = (data ?? []).map((row) =>
    rowToUser({
      ...row,
      manager_name: (row.manager as Record<string, unknown> | null)?.full_name ?? '',
      team_name: (row.team as Record<string, unknown> | null)?.name ?? '',
    })
  );

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (u) =>
        u.full_name.toLowerCase().includes(q) ||
        u.email_prefix.toLowerCase().includes(q) ||
        (u.department ?? '').toLowerCase().includes(q)
    );
  }
  if (filters?.role && filters.role.length > 0) {
    results = results.filter((u) => filters.role!.includes(u.role));
  }
  if (filters?.status && filters.status.length > 0) {
    results = results.filter((u) => filters.status!.includes(u.status));
  }
  if (filters?.department && filters.department.length > 0) {
    results = results.filter((u) =>
      filters.department!.includes(u.department ?? '')
    );
  }
  if (filters?.has_team !== undefined) {
    results = results.filter((u) =>
      filters.has_team ? !!u.team_id : !u.team_id
    );
  }

  return results;
}

export async function getUserById(id: string): Promise<User | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('users')
    .select(`
      *,
      manager:users!manager_id(full_name),
      team:teams!team_id(name)
    `)
    .eq('id', id)
    .single();

  if (error || !data) return null;

  return rowToUser({
    ...data,
    manager_name: (data.manager as Record<string, unknown> | null)?.full_name ?? '',
    team_name: (data.team as Record<string, unknown> | null)?.name ?? '',
  });
}

export async function createUser(
  input: UserFormData,
  createdBy: string
): Promise<User | null> {
  const supabase = createServiceClient();
  const email = `${input.email_prefix}@suno.com.br`;
  const fullName = `${input.first_name} ${input.last_name}`.trim();

  // Step A: Create auth user (no password — user will sign in via Google OAuth)
  // Trigger on auth.users INSERT auto-creates a basic public.users row.
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,   // mark email as verified so Google SSO links correctly
    user_metadata: { full_name: fullName, role: input.role },
  });

  if (authError || !authData.user) {
    console.error('[createUser] auth user creation failed:', authError?.message);
    return null;
  }

  // Step B: Update the public.users row created by the trigger with full profile data
  const { error: updateError } = await supabase
    .from('users')
    .update({
      full_name:  fullName,
      role:       input.role,
      department: input.department ?? null,
      manager_id: input.manager_id ?? null,
      team_id:    input.team_id ?? null,
      status:     'pending',
      created_by: createdBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', authData.user.id);

  if (updateError) {
    console.error('[createUser] profile update failed:', updateError.message);
    // Rollback auth user so DB and auth stay in sync
    await supabase.auth.admin.deleteUser(authData.user.id);
    return null;
  }

  return getUserById(authData.user.id);
}

export async function updateUser(
  id: string,
  input: Partial<UserFormData>
): Promise<User | null> {
  const supabase = createServiceClient();

  const payload: Record<string, unknown> = {};
  if (input.first_name !== undefined || input.last_name !== undefined) {
    // Need both to set full_name — fetch current if only one provided
    const current = await getUserById(id);
    const first = input.first_name ?? current?.first_name ?? '';
    const last = input.last_name ?? current?.last_name ?? '';
    payload.full_name = `${first} ${last}`.trim();
  }
  if (input.email_prefix !== undefined) payload.email = `${input.email_prefix}@suno.com.br`;
  if (input.role !== undefined) payload.role = input.role;
  if (input.department !== undefined) payload.department = input.department;
  if (input.manager_id !== undefined) payload.manager_id = input.manager_id ?? null;
  if (input.team_id !== undefined) payload.team_id = input.team_id ?? null;

  const { error } = await supabase.from('users').update(payload).eq('id', id);

  if (error) {
    console.error('[updateUser]', error.message);
    return null;
  }

  return getUserById(id);
}

export async function deactivateUser(id: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('users')
    .update({ is_active: false, status: 'inactive' })
    .eq('id', id);
  return !error;
}

/**
 * Re-send a Google OAuth "magic link" for a pending user by generating
 * a password reset link (works as a sign-in link for accounts without passwords).
 * The user clicks it and is prompted to link their Google account.
 */
export async function resendInvite(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const user = await getUserById(userId);
  if (!user?.full_email) return false;

  // Generate a recovery link so the user can sign in and link their Google account
  const { error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: user.full_email,
  });
  if (error) {
    console.error('[resendInvite]', error.message);
    return false;
  }
  return true;
}

// =====================================================
// TEAMS
// =====================================================

export async function getTeams(filters?: TeamFilters): Promise<Team[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      manager:users!manager_id(full_name),
      creator:users!created_by(full_name),
      members:team_members(
        user_id,
        role_in_team,
        joined_at,
        user:users!user_id(full_name, email)
      )
    `)
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('[getTeams]', error.message);
    return [];
  }

  let results = (data ?? []).map((row) => {
    const members = ((row.members as Record<string, unknown>[]) ?? []).map((m) => ({
      user_id: m.user_id as string,
      user_name: (m.user as Record<string, unknown>)?.full_name as string ?? '',
      user_email: (m.user as Record<string, unknown>)?.email as string ?? '',
      role_in_team: m.role_in_team as string | undefined,
      joined_at: new Date(m.joined_at as string),
    }));

    return rowToTeam({
      ...row,
      manager_name: (row.manager as Record<string, unknown> | null)?.full_name ?? '',
      created_by_name: (row.creator as Record<string, unknown> | null)?.full_name ?? '',
      members,
    });
  });

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
    );
  }
  if (filters?.department && filters.department.length > 0) {
    results = results.filter((t) =>
      filters.department!.includes(t.department ?? '')
    );
  }
  if (filters?.manager_id) {
    results = results.filter((t) => t.manager_id === filters.manager_id);
  }

  return results;
}

export async function getTeamById(id: string): Promise<Team | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      manager:users!manager_id(full_name),
      creator:users!created_by(full_name),
      members:team_members(
        user_id,
        role_in_team,
        joined_at,
        user:users!user_id(full_name, email)
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return null;

  const members = ((data.members as Record<string, unknown>[]) ?? []).map((m) => ({
    user_id: m.user_id as string,
    user_name: (m.user as Record<string, unknown>)?.full_name as string ?? '',
    user_email: (m.user as Record<string, unknown>)?.email as string ?? '',
    role_in_team: m.role_in_team as string | undefined,
    joined_at: new Date(m.joined_at as string),
  }));

  return rowToTeam({
    ...data,
    manager_name: (data.manager as Record<string, unknown> | null)?.full_name ?? '',
    created_by_name: (data.creator as Record<string, unknown> | null)?.full_name ?? '',
    members,
  });
}

export async function createTeam(
  input: TeamFormData,
  createdBy: string
): Promise<Team | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('teams')
    .insert({
      name: input.name,
      description: input.description,
      manager_id: input.manager_id,
      department: input.department,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[createTeam]', error?.message);
    return null;
  }

  // Add members
  if (input.member_ids.length > 0) {
    await supabase.from('team_members').insert(
      input.member_ids.map((userId) => ({
        team_id: data.id,
        user_id: userId,
      }))
    );

    // Update team_id on users
    await supabase
      .from('users')
      .update({ team_id: data.id })
      .in('id', input.member_ids);
  }

  return getTeamById(data.id);
}

export async function updateTeam(
  id: string,
  input: Partial<TeamFormData>
): Promise<Team | null> {
  const supabase = createServiceClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.manager_id !== undefined) payload.manager_id = input.manager_id;
  if (input.department !== undefined) payload.department = input.department;

  if (Object.keys(payload).length > 0) {
    const { error } = await supabase.from('teams').update(payload).eq('id', id);
    if (error) {
      console.error('[updateTeam]', error.message);
      return null;
    }
  }

  // Re-sync members if provided
  if (input.member_ids !== undefined) {
    // Get current members to handle team_id cleanup
    const { data: currentMembers } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', id);

    const currentIds = (currentMembers ?? []).map((m) => m.user_id);
    const removedIds = currentIds.filter((uid) => !input.member_ids!.includes(uid));

    // Remove old members
    if (removedIds.length > 0) {
      await supabase.from('team_members').delete().eq('team_id', id).in('user_id', removedIds);
      await supabase.from('users').update({ team_id: null }).in('id', removedIds);
    }

    // Add new members
    const addedIds = input.member_ids.filter((uid) => !currentIds.includes(uid));
    if (addedIds.length > 0) {
      await supabase.from('team_members').insert(
        addedIds.map((userId) => ({ team_id: id, user_id: userId }))
      );
      await supabase.from('users').update({ team_id: id }).in('id', addedIds);
    }
  }

  return getTeamById(id);
}

export async function deleteTeam(id: string): Promise<boolean> {
  const supabase = createServiceClient();

  // Clear team_id from members
  await supabase.from('users').update({ team_id: null }).eq('team_id', id);

  const { error } = await supabase.from('teams').update({ is_active: false }).eq('id', id);
  return !error;
}
