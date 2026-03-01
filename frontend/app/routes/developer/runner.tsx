import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/developer/runner')({
  beforeLoad: () => {
    throw redirect({ to: '/playground' })
  },
  component: () => null,
})
