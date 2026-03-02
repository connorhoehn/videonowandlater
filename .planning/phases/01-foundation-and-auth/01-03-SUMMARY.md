---
phase: 01-foundation-and-auth
plan: "03"
status: complete
completed_at: "2026-03-02"
duration_minutes: 15
---

# Plan 01-03: React Frontend with Amplify Auth - SUMMARY

## What Was Built

Complete React + Vite frontend with Amplify-powered authentication, including signup, login, logout, session persistence, and stack-not-deployed detection.

### Artifacts Created

**Core Config & Auth:**
- `web/src/config/aws-config.ts` - Runtime config loader that fetches `/aws-config.json` and returns null when stack not deployed
- `web/src/auth/amplify.ts` - Amplify configuration and auth wrapper functions (signUp, signIn, signOut, checkSession)
- `web/src/auth/AuthContext.tsx` - React context managing auth state with session persistence via Amplify localStorage
- `web/src/auth/useAuth.ts` - Custom hook for accessing auth context

**Pages:**
- `web/src/pages/LoginPage.tsx` - Login form with username/password, error display, loading state, link to signup
- `web/src/pages/SignupPage.tsx` - Signup form with password requirements hint, auto-sign-in on success
- `web/src/pages/HomePage.tsx` - Welcome screen showing username with logout button

**Components:**
- `web/src/components/StackNotDeployed.tsx` - Developer guidance screen shown when aws-config.json is missing
- `web/src/components/Layout.tsx` - Header with app name, username display, and persistent logout button (satisfies AUTH-04: logout from any page)

**Root:**
- `web/src/App.tsx` - Root component with routing, config loading, stack-not-deployed detection, and protected routes
- `web/src/main.tsx` - React entry point

**Infrastructure Fix:**
- `infra/lib/lambdas/auto-confirm-user.ts` - PreSignUp Lambda trigger that auto-confirms users (fixes "User is not confirmed" error)
- Updated `infra/lib/stacks/auth-stack.ts` to wire auto-confirm trigger to User Pool

### Requirements Delivered

- **AUTH-01** ✓ Users can sign up with username and password
- **AUTH-02** ✓ Users can log in with valid credentials
- **AUTH-03** ✓ Session persists across browser refresh (Amplify localStorage)
- **AUTH-04** ✓ Users can log out from any page (Layout header button)
- **DEV-07** ✓ Frontend detects stack-not-deployed and shows guidance

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Auto-confirm Lambda trigger | Self-signup users were getting "User is not confirmed" error without email verification | ✓ Users can now sign up and log in immediately |
| Type-only imports (`import type`) | TypeScript `verbatimModuleSyntax` enforces separation of types and values | ✓ Build succeeds with proper type imports |
| Remove unused React imports | React 19 with modern JSX transform doesn't require React in scope | ✓ Cleaner imports, no TS errors |
| Inline styles for MVP | No CSS framework needed for Phase 1 auth screens | ✓ Fast implementation, can refactor later |
| Protected route wrapper | Centralize auth checks for all protected pages | ✓ Reusable pattern for future routes |

## Technical Notes

**Amplify Auth Setup:**
- Uses `aws-amplify` v6.12.2 with modular imports (`aws-amplify/auth`)
- Config loaded at runtime (not build-time) to avoid rebuild on stack changes
- Session state managed via `getCurrentUser()` + `fetchAuthSession()` on mount
- Auto-sign-in after signup for seamless UX

**Routing:**
- `/login` - Public login page
- `/signup` - Public signup page
- `/` - Protected home page (redirects to /login if not authenticated)
- Layout wraps protected routes to show header with logout

**Stack Detection:**
- Fetches `/aws-config.json` on app mount
- Missing or failed fetch → shows StackNotDeployed screen
- Successful fetch → configures Amplify and renders auth flow

**Developer Experience:**
- TypeScript strict mode with `verbatimModuleSyntax`
- Build time: ~880ms
- Hot reload with Vite dev server

## Verification Results

✅ **Automated Checks:**
- TypeScript type check passes (`npx tsc --noEmit`)
- Build succeeds (`npm run build`)
- All files present and meet line count requirements

✅ **Human Verification:**
- Stack deployed successfully with auto-confirm trigger
- Users can sign up via web UI and log in immediately
- Session persists across browser refresh
- Logout works from home page and layout header
- Stack-not-deployed screen displays when config is missing
- Developer CLI tools (create-user, get-token, list-users, delete-user) work correctly

## Concerns & Future Work

**Addressed:**
- ~~"User is not confirmed" error~~ → Fixed with auto-confirm Lambda trigger

**Future Phases:**
- Phase 2+ will add session creation UI to HomePage
- May add CSS framework (Tailwind?) if design complexity increases
- Protected routes pattern ready to extend for more pages

## Files Changed

```
infra/lib/lambdas/auto-confirm-user.ts (new)
infra/lib/stacks/auth-stack.ts (modified - added Lambda trigger)
web/src/App.tsx (modified - config loading, routing)
web/src/auth/AuthContext.tsx (modified - type imports)
web/src/auth/amplify.ts (modified - type imports)
web/src/auth/useAuth.ts (modified - type imports)
web/src/components/Layout.tsx (new)
web/src/components/StackNotDeployed.tsx (new)
web/src/config/aws-config.ts (existing - scaffolded earlier)
web/src/pages/HomePage.tsx (new)
web/src/pages/LoginPage.tsx (new)
web/src/pages/SignupPage.tsx (new)
```

## Performance Metrics

- Duration: 15 minutes (includes debugging auto-confirm issue)
- Build time: 880ms
- TypeScript check: <1s
- Files created: 9
- Lines added: ~1400
- Commits: 2 (main implementation + auto-confirm fix)

---

**Phase 1 Status:** Plan 3 of 3 complete → Phase 1 complete ✓
**Next:** Transition to Phase 2 (Session Management & Presence)
