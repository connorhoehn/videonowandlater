/**
 * CASL Ability definitions — isomorphic between backend and frontend.
 *
 * Actions:   read | create | update | delete | kill | join | invite | ban | manage
 * Subjects:  Session | User | Group | Ruleset | all
 *
 * Roles:
 *  - admin         → manage all
 *  - moderator     → kill Session, ban User
 *  - user          → manage own User
 *  - (group owner) → manage own Group (matched on ownerId)
 *  - (group admin) → invite / remove members on Group
 */

import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

export type AppActions =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'kill'
  | 'join'
  | 'invite'
  | 'ban'
  | 'manage';

export type AppSubjects = 'Session' | 'User' | 'Group' | 'Ruleset' | 'all';

/**
 * We use CASL's plain `MongoAbility` so that ad-hoc condition objects like
 * `{ groupId: 'g1' }` or `{ userId: 'u1' }` are accepted. Stricter per-
 * subject typing would require mapping every subject to an interface; our
 * condition keys are small & documented inline.
 */
export type AppAbility = MongoAbility;

export type AppRole = 'admin' | 'moderator' | 'user';

export type GroupRole = 'owner' | 'admin' | 'member';

export interface AbilityContext {
  userId: string;
  role: AppRole;
  /** Map of groupId → groupRole for groups this user belongs to (optional). */
  groupMemberships?: Record<string, GroupRole>;
}

/**
 * Build an Ability for a given user context.
 * This function is pure — no side effects, no I/O — so it can run in
 * the browser or in Lambda identically.
 */
export function defineAbilityFor(ctx: AbilityContext): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // --- Global role rules -------------------------------------------------
  if (ctx.role === 'admin') {
    can('manage', 'all');
    return build();
  }

  if (ctx.role === 'moderator') {
    can('kill', 'Session');
    can('ban', 'User');
    can('read', 'Session');
    can('read', 'User');
    can('read', 'Group');
  }

  // --- Every authenticated user ----------------------------------------
  // Users can manage their own User record (match userId)
  can('manage', 'User', { userId: ctx.userId });
  // Any authenticated user can create groups
  can('create', 'Group');
  // Users can read public groups and groups they belong to (resource check done at runtime)
  can('read', 'Group', { visibility: 'public' });

  // --- Per-group rules -------------------------------------------------
  if (ctx.groupMemberships) {
    for (const [groupId, groupRole] of Object.entries(ctx.groupMemberships)) {
      // All members can read and join their own group
      can('read', 'Group', { groupId });
      can('join', 'Group', { groupId });

      if (groupRole === 'owner') {
        can('manage', 'Group', { groupId });
      } else if (groupRole === 'admin') {
        can('invite', 'Group', { groupId });
        can('update', 'Group', { groupId });
        // Admins cannot delete the group or promote members (owner-only)
        cannot('delete', 'Group', { groupId });
      }
    }
  }

  return build();
}

/**
 * Convenience: derive a simple role string from Cognito groups.
 */
export function roleFromCognitoGroups(groups: string[] | string | undefined): AppRole {
  if (!groups) return 'user';
  const list = Array.isArray(groups) ? groups : groups.split(',').map((g) => g.trim());
  if (list.includes('admin')) return 'admin';
  if (list.includes('moderator')) return 'moderator';
  return 'user';
}
