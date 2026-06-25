# Local Setup

This branch runs without end-user authentication. Server functions use a fixed
local user id plus a server-only Supabase secret key.

## 1. Environment

Copy `.env.local.example` to `.env.local` and fill the values.

Public browser values:

```env
VITE_ENABLE_AUTH=false
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Server-only values:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
OPENAI_API_KEY=
AI_MODEL_FAST=gpt-4o-mini
AI_MODEL_DEEP=gpt-4o
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

Never add a `VITE_` prefix to `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, or
`AZURE_SPEECH_KEY`.

## 2. Supabase migrations

Apply the project migrations to your Supabase project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The final local migration removes the `sessions.user_id -> auth.users` foreign
key so the fixed local user can create sessions without Supabase Auth.

## 3. Run

```bash
pnpm install
pnpm run dev
```

Onboarding file upload and pasted-image upload go through server functions, so
they work in local no-auth mode after the Supabase storage bucket migration is
applied.
