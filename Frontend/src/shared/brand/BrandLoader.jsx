import Runner, { Wordmark } from './Runner'

/**
 * What shows while a page's code loads. A branded screen rather than a skeleton:
 * this loader is shared by pages with nothing in common, so any guessed layout
 * is wrong for most of them. `full` is the yellow landing version, which the
 * landing page's own opening continues without a jump.
 */
export default function BrandLoader({ full = false }) {
  return (
    <div className={`zb-load ${full ? 'zb-full' : ''}`} role="status">
      <span className="zb-sr">Loading</span>
      <div className="zb-runner"><Runner running /></div>
      {full ? <Wordmark className="zb-word" /> : <div className="zb-track" aria-hidden="true"><i /></div>}
    </div>
  )
}
