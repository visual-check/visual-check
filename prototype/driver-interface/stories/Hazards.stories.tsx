// PROTOTYPE: page hazards for the Driver interface prototype. Copied into the Storybook under test before its build.
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const Box = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div style={{ fontFamily: 'Montserrat, sans-serif', padding: 24, border: '4px solid #e5175c', width: 520 }}>
    <h2 style={{ margin: 0 }}>{title}</h2>
    <div style={{ marginTop: 12, fontSize: 18 }}>{children}</div>
  </div>
)

// Dialogs open during render, so they happen before storyFinished and the result is part of the snapshot
const Alert = () => {
  const [r] = React.useState(() => { window.alert('vc alert'); return 'alert returned' })
  return <Box title="alert()">{r}</Box>
}
const Confirm = () => {
  const [r] = React.useState(() => String(window.confirm('vc confirm')))
  return <Box title="confirm()">returned {r}</Box>
}
const Prompt = () => {
  const [r] = React.useState(() => String(window.prompt('vc prompt', 'default')))
  return <Box title="prompt()">returned {r}</Box>
}
// Fires only with user activation: Playwright's evaluate passes userGesture, and so does the raw driver
const BeforeUnload = () => {
  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
  }, [])
  return <Box title="beforeunload">handler registered, never removed</Box>
}
const Popup = () => {
  const [r] = React.useState(() => {
    const w = window.open('./iframe.html?id=vc-hazards--iframe-srcdoc&viewMode=story', '_blank')
    return w ? 'opened' : 'blocked'
  })
  return <Box title="window.open()">popup {r}</Box>
}
const IframeSrcdoc = () => (
  <Box title="iframe">
    <iframe
      title="srcdoc"
      width={460}
      height={120}
      srcDoc="<body style='margin:0;background:#ffd23f;font:20px sans-serif'><p style='margin:16px'>inside a srcdoc iframe</p></body>"
    />
  </Box>
)
const Download = () => {
  const [r] = React.useState(() => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['visual-check'], { type: 'text/plain' }))
    a.download = 'vc.txt'
    document.body.append(a)
    a.click()
    a.remove()
    return 'clicked a download link'
  })
  return <Box title="download">{r}</Box>
}
const Permissions = () => {
  const [r, set] = React.useState('pending')
  React.useEffect(() => {
    Promise.all([
      Notification.requestPermission().catch((e) => `error ${e.name}`),
      new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('granted'), (e) => res(`error ${e.code}`), { timeout: 2000 })),
    ]).then(([n, g]) => set(`notification ${n}, geolocation ${g}`))
  }, [])
  return <Box title="permissions">{r}</Box>
}
// Exhausts the renderer's JS heap after first paint, so the page crashes before storyFinished resolves readiness
const Crash = () => {
  React.useEffect(() => {
    const keep: number[][] = []
    for (;;) keep.push(new Array(1e6).fill(Math.random()))
  }, [])
  return <Box title="renderer crash">about to run out of memory</Box>
}

const meta: Meta = { title: 'vc-hazards' }
export default meta
type S = StoryObj
export const AlertDialog: S = { render: () => <Alert /> }
export const ConfirmDialog: S = { render: () => <Confirm /> }
export const PromptDialog: S = { render: () => <Prompt /> }
export const BeforeUnloadHandler: S = { render: () => <BeforeUnload /> }
export const WindowOpen: S = { render: () => <Popup /> }
export const IframeSrcdoc_: S = { name: 'Iframe srcdoc', render: () => <IframeSrcdoc /> }
export const DownloadLink: S = { render: () => <Download /> }
export const PermissionRequests: S = { render: () => <Permissions /> }
export const RendererCrash: S = { render: () => <Crash /> }
