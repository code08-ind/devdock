import { useRef, useState } from 'react'
import { BookOpenCheck, MessageSquareText, Plus, Sparkles } from 'lucide-react'
import type { View } from '@shared/channels'
import { groupComments, lessonFromComment, prRepo } from '@shared/lessons'
import { useAddLessons, useLessons, useReviewComments } from '../../lib/utilities'
import { Button } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Checkbox, Field, Input, SegmentedControl } from '../../ui/Field'
import { SetUp } from '../today/TodayPage'
import { useAiAvailable } from '../../lib/ai'
import { AiDialog } from '../ai/AiDialog'

interface Candidate {
  /** Stable across refetches: reviewer + comment text (or "own-n" for my own). */
  key: string
  /** Where it came from: "Priya Reviewer on web-app #415", or "Your lesson". */
  source: string
  text: string
  picked: boolean
  /** The reviewer's comment it came from (P7-C-B: Claude can word it as a lesson). */
  comment?: { text: string; where: string }
}

type Scope = 'repo' | 'all'

/**
 * Agent lessons (P6-F): the repo's lessons file, review comments on my recent PRs to turn into
 * lessons, and my own. Nothing is written until I pick lessons and press Add; each lesson can be
 * edited first. The agent reads the file on Start work and adds what it learns (Settings → Workflow).
 */
export function LessonsPanel({ repoId, onView }: { repoId: string; onView: (v: View) => void }) {
  const toast = useToast()
  const state = useLessons(repoId)
  const [asked, setAsked] = useState(false)
  const comments = useReviewComments(asked)
  const add = useAddLessons(repoId)
  // My changes to offered lessons (text, ticked), by candidate key; untouched ones aren't here.
  const [edits, setEdits] = useState<Record<string, Pick<Candidate, 'text' | 'picked'>>>({})
  const [own, setOwn] = useState<Candidate[]>([])
  const ownCount = useRef(0)
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<Scope | null>(null)
  const aiAvailable = useAiAvailable()
  const [wording, setWording] = useState<Candidate | null>(null)

  const path = state.data?.path ?? 'the lessons file'
  const remotes = state.data?.remoteRepos ?? []
  const grouped = groupComments(comments.data ?? [])
  // This repo's PRs first: by its remotes' repo names. Every PR when none match.
  const mine = grouped.filter((c) => c.pr.split(', ').some((p) => remotes.includes(prRepo(p))))
  const shown = (scope ?? (mine.length ? 'repo' : 'all')) === 'repo' ? mine : grouped
  const offered = shown.map((c): Candidate => {
    const key = `${c.author}\n${c.text}`
    return {
      key,
      source: `${c.author} on ${c.pr}`,
      text: lessonFromComment(c),
      picked: false,
      comment: { text: c.text, where: c.path ? `${c.pr} ${c.path}` : c.pr },
      ...edits[key],
    }
  })
  const all = [...offered, ...own]
  const picked = all.filter((c) => c.picked && c.text.trim())

  const change = (c: Candidate, patch: Partial<Pick<Candidate, 'text' | 'picked'>>) => {
    if (c.key.startsWith('own-')) {
      setOwn((list) => list.map((o) => (o.key === c.key ? { ...o, ...patch } : o)))
    } else {
      setEdits((e) => ({
        ...e,
        [c.key]: { text: c.text, picked: c.picked, ...e[c.key], ...patch },
      }))
    }
  }
  const addOwn = () => {
    const text = draft.trim()
    if (!text) return
    ownCount.current += 1
    const key = `own-${ownCount.current}`
    setOwn((list) => [...list, { key, source: 'Your lesson', text, picked: true }])
    setDraft('')
  }
  const save = () => {
    const done = new Set(picked.map((c) => c.key))
    add.mutate(
      picked.map((c) => c.text.trim()),
      {
        onSuccess: (r) => {
          toast(
            r.added > 0
              ? `Added ${r.added} ${r.added === 1 ? 'lesson' : 'lessons'} to ${r.path}`
              : `Those lessons are already in ${r.path}`,
          )
          setOwn((list) => list.filter((o) => !done.has(o.key)))
          setEdits((e) =>
            Object.fromEntries(
              Object.entries(e).map(([k, v]) => [k, done.has(k) ? { ...v, picked: false } : v]),
            ),
          )
        },
      },
    )
  }

  return (
    <section className="stack" aria-label="Lessons">
      {wording?.comment ? (
        <AiDialog
          request={{
            feature: 'lesson',
            comment: wording.comment.text,
            where: wording.comment.where,
          }}
          onClose={() => setWording(null)}
          onUse={{
            label: 'Use as the lesson',
            use: (text) => change(wording, { text: text.slice(0, 500), picked: true }),
          }}
        />
      ) : null}
      <p className="muted">
        Your agent reads <span className="mono">{path}</span> when you start work on a ticket, and
        adds what it learns there. Pick what reviewers keep asking for; the file and these options
        are in Settings → Workflow. The file is meant to be committed, so teammates&apos; agents
        learn too: each lesson keeps the review comment&apos;s words and its pull request number,
        not the reviewer&apos;s name.
      </p>

      <h2 className="group-title">In the file now</h2>
      {state.error ? (
        <ErrorNotice error={state.error} />
      ) : !state.data ? (
        <p className="muted" role="status">
          Reading {path}…
        </p>
      ) : state.data.lessons.length === 0 ? (
        <p className="muted">
          {state.data.exists
            ? 'No lessons in the file yet.'
            : `No lessons file yet: adding one creates ${path}.`}
        </p>
      ) : (
        <ul className="lessons-current" aria-label="Lessons in the file">
          {state.data.lessons.map((l, i) => (
            <li key={`${i}:${l}`}>{l}</li>
          ))}
        </ul>
      )}

      <h2 className="group-title">From review comments</h2>
      {!asked ? (
        <div>
          <Button
            icon={<MessageSquareText size={16} aria-hidden="true" />}
            onClick={() => setAsked(true)}
          >
            Collect review comments
          </Button>
        </div>
      ) : comments.error ? (
        <SetUp error={comments.error} onView={onView} />
      ) : comments.isPending ? (
        <p className="muted" role="status">
          Reading comments on your recent pull requests…
        </p>
      ) : grouped.length === 0 ? (
        <p className="muted">No review comments on your recent pull requests.</p>
      ) : (
        <>
          {mine.length ? (
            <SegmentedControl
              label="Comments from"
              options={[
                { value: 'repo' as Scope, label: `This repo's pull requests (${mine.length})` },
                { value: 'all' as Scope, label: `All my pull requests (${grouped.length})` },
              ]}
              value={scope ?? 'repo'}
              onValue={setScope}
            />
          ) : (
            <p className="muted">
              None of your recent pull requests are from this repo&apos;s remotes: showing them all.
            </p>
          )}
        </>
      )}

      {all.length ? (
        <ul className="lesson-candidates" aria-label="Lessons to pick">
          {all.map((c) => (
            <li key={c.key} className="lesson-candidate">
              <Checkbox
                label={c.source}
                checked={c.picked}
                onChecked={(isPicked) => change(c, { picked: isPicked })}
              />
              <Input
                aria-label={`Lesson from ${c.source}`}
                value={c.text}
                maxLength={500}
                onChange={(e) => change(c, { text: e.target.value, picked: true })}
              />
              {aiAvailable && c.comment ? (
                <Button
                  variant="ghost"
                  icon={<Sparkles size={16} aria-hidden="true" />}
                  aria-label={`Word the lesson from ${c.source} with Claude`}
                  onClick={() => setWording(c)}
                >
                  Word with Claude
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="inline-form field-row"
        onSubmit={(e) => {
          e.preventDefault()
          addOwn()
        }}
      >
        <Field label="Your own lesson">
          {({ id }) => (
            <Input
              id={id}
              value={draft}
              maxLength={500}
              placeholder="Run the visual tests before pushing UI changes"
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" icon={<Plus size={16} aria-hidden="true" />} disabled={!draft.trim()}>
          Add to the list
        </Button>
      </form>

      {add.error ? <ErrorNotice error={add.error} /> : null}
      <div className="button-row">
        <Button
          variant="primary"
          icon={<BookOpenCheck size={16} aria-hidden="true" />}
          disabled={picked.length === 0 || add.isPending}
          onClick={save}
        >
          {picked.length === 0
            ? 'Pick lessons to add'
            : `Add ${picked.length} ${picked.length === 1 ? 'lesson' : 'lessons'} to ${path}`}
        </Button>
      </div>
    </section>
  )
}
