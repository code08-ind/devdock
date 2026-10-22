import type { ReactNode } from 'react'

/** A titled settings group. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="settings-section" aria-labelledby={`${id}-title`}>
      <div className="settings-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}
