import { Link } from "react-router-dom"

/**
 * A link from the admin-edited layout. Layout links are app paths; "/spin" is
 * the one that is not a page — it opens the Spin & Win wheel (UserLayout
 * listens for "wh:open-spin").
 */
export default function AppLink({ to, className, children, ...rest }) {
  if (!to) {
    return (
      <div className={className} {...rest}>
        {children}
      </div>
    )
  }
  if (to === "/spin" || to.startsWith("/spin?")) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("wh:open-spin"))}
        className={`text-left ${className || ""}`}
        {...rest}
      >
        {children}
      </button>
    )
  }
  return (
    <Link to={to} className={className} {...rest}>
      {children}
    </Link>
  )
}
