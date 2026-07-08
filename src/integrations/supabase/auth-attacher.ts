import { createMiddleware } from '@tanstack/react-start'
import { supabase } from './client'

// Local migration mode defaults to no auth. Set VITE_ENABLE_AUTH=true when
// re-enabling Supabase Auth; then this middleware attaches the bearer token.
export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    if (import.meta.env.VITE_ENABLE_AUTH !== "true") {
      return next({ headers: {} })
    }
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  },
)
