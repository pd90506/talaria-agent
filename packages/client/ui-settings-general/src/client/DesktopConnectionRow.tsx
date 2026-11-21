/** Desktop server connection: run the agent on this computer or open a remote dsh server; Electron persists the choice. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopConnectionBridge, DesktopConnectionTarget } from '../types.ts'
import css from './DesktopConnectionRow.module.css'

/** Shell bridge supplied only inside Desktop. */
export interface DesktopConnectionRowInjected {
  connection: DesktopConnectionBridge
}

type Status = 'idle' | 'saving' | 'invalid' | 'failed' | 'restarting'

/**
 * Render the connection choice. Saving restarts Desktop into the chosen target.
 * @param props - Shell bridge and localized copy.
 * @returns The General settings row.
 */
export function DesktopConnectionRow({ connection, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DesktopConnectionRowInjected>) {
  const [current, setCurrent] = useState<DesktopConnectionTarget | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  useEffect(() => {
    let live = true
    connection.get().then((value) => {
      if (!live) return
      setCurrent(value)
      if (value.mode === 'remote') setDraft(value.url)
    }, () => { if (live) setStatus('failed') })
    return () => { live = false }
  }, [connection])
  const apply = (target: DesktopConnectionTarget): void => {
    setStatus('saving')
    connection.set(target).then((result) => {
      setStatus(result.kind === 'saved' ? 'restarting' : 'invalid')
    }, () => { setStatus('failed') })
  }
  const busy = status === 'saving' || status === 'restarting'
  const remote = current?.mode === 'remote'
  return <div className={css.row} role="group" aria-label={t('desktop.connection.title')}>
    <div className={css.rowText}>
      <div className={css.title}>{t('desktop.connection.title')}</div>
      <div className={css.description}>{t('desktop.connection.description')}</div>
      {current !== undefined && <div className={css.current}>
        {remote ? t('desktop.connection.currentRemote', { url: current.url }) : t('desktop.connection.currentLocal')}
      </div>}
      {status === 'invalid' && <div role="alert" className={css.error}>{t('desktop.connection.invalid')}</div>}
      {status === 'failed' && <div role="alert" className={css.error}>{t('desktop.connection.failed')}</div>}
      {status === 'restarting' && <div role="status" className={css.current}>{t('desktop.connection.restarting')}</div>}
    </div>
    <form className={css.controls} onSubmit={(event) => { event.preventDefault(); apply({ mode: 'remote', url: draft }) }}>
      <Input value={draft} placeholder={t('desktop.connection.placeholder')} type="url"
        aria-label={t('desktop.connection.address')} aria-invalid={status === 'invalid'} disabled={busy}
        autoComplete="off" spellCheck={false} onChange={(event) => { setDraft(event.target.value); if (status === 'invalid') setStatus('idle') }} />
      <div className={css.buttons}>
        <Button type="button" variant="outline" size="sm" disabled={busy || current === undefined || !remote}
          onClick={() => { apply({ mode: 'local' }) }}>{t('desktop.connection.useLocal')}</Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || draft.trim() === ''}>{t('desktop.connection.connect')}</Button>
      </div>
    </form>
  </div>
}
