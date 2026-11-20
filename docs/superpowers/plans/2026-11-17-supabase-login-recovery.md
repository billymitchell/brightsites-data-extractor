# Supabase Login Recovery Implementation Plan

**Goal**  
Restore the Centricity reporting project's Supabase Auth service when inactivity pauses it, then let users request their email sign-in codes.

**Architecture**  
Use one recovery coordinator per Heroku web process. Start a background check at boot and reuse the coordinator when an eligible login request encounters an unavailable Auth endpoint. Keep the Express server available while Supabase restores.

**Tech stack**  
Existing Node.js, CommonJS, Express, node-fetch, and node:test. Use the Supabase Management API for status and restoration.

## 1. Add project recovery

- [ ] Add optional server-side settings in `config/auth.js` and `.env.example` for the project reference and `SUPABASE_MANAGEMENT_TOKEN`. Require both when enabling recovery in email mode. Use a token scoped to the Centricity project with the permissions documented for [Get project](https://supabase.com/docs/reference/api/v1-get-project) and [Restore a project](https://supabase.com/docs/reference/api/v1-restore-a-project). Keep the token in Heroku config and out of logs and browser responses.
- [ ] Add `createProjectRecovery({ projectRef, token, authUrl, authKey, fetchImpl })` in `lib/supabaseProjectRecovery.js`, exposing `checkAndRecover()`. Fetch status from `GET https://api.supabase.com/v1/projects/{ref}`. Request `POST /v1/projects/{ref}/restore` only when Supabase confirms the project is paused and eligible to restore. Treat DNS failures and ambiguous states as reasons to check status. If restoration is already running, join it by polling status.
- [ ] Confirm readiness with a successful Auth health probe before returning success. Share in-progress work across concurrent callers. Bound request timeouts and background polling, honor recovery API backoff, and log failures without credentials or email addresses. If a restore request times out, check status before considering another restore request.
- [ ] Test active, paused, restoring, and unhealthy projects, API authorization and rate-limit failures, Auth readiness lag, and concurrent callers sharing one restore.

## 2. Wire startup and login

- [ ] In `server.js`, start the recovery check in the background once the server is listening and pass the same coordinator to email authentication. Preserve the current startup and login behavior when recovery is disabled.
- [ ] In `lib/emailAuth.js` and `middleware/emailAuth.js`, retain existing company-email validation and rate limits. If the startup check is already restoring the project, hold the OTP request until Auth is ready. For a project that pauses after startup, trigger recovery when a login attempt encounters an unreachable Auth host or a response that explicitly indicates a paused project. Only retry an OTP call when the first attempt is known to have failed before Supabase could accept it. A timeout can leave delivery uncertain.
- [ ] Bound the login request's wait below Heroku's router timeout. While restoration is confirmed and still underway at that deadline, return HTTP 503 and display “Sign-in is starting up. Please try again shortly.” Continue the restore in the background and let the user submit a fresh request when ready. Keep generic service errors for other failures.
- [ ] Add regression coverage in `test/emailAuth.test.js` for healthy sign-in, recovery on startup and after startup, a restore longer than the login wait, and an ambiguous OTP timeout. Assert the app sends no OTP while Auth is known to be unavailable and sends at most one accepted OTP per submission. Run `npm test`.

## 3. Verify the deployment

- [ ] Document the Heroku settings and recovery messages in `README.md`. Exercise the paused-to-active flow on a test Supabase project before configuring production. Verify both startup and login-triggered recovery, then verify that a real company inbox receives one code and completes sign-in.
