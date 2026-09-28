import { Navigate, useLocation } from 'react-router-dom'
import { LOGIN_PATH } from './services'

/**
 * Sends an old per-service sign-in URL to the platform sign-in, keeping its
 * query. Invite links shared before there was one sign-in (Food's
 * /food/user/auth/login?ref=, the Shop's /auth/login?ref=, Taxi's
 * /taxi/user/signup?ref=) still carry the friend's code there; a plain
 * <Navigate to="/login"> dropped it.
 *
 * `via` names the service whose referral programme the old link belonged to,
 * added only when the link does not already say.
 */
export default function LoginRedirect({ via }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  // Taxi's old signup links used ?referral= as well as ?ref=.
  if (!params.get('ref') && params.get('referral')) params.set('ref', params.get('referral'))
  params.delete('referral')
  if (via && params.get('ref') && !params.get('via')) params.set('via', via)
  const qs = params.toString()
  return <Navigate to={`${LOGIN_PATH}${qs ? `?${qs}` : ''}`} replace />
}
