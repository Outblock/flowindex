import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/developer/subscriptions')({
  component: () => <Outlet />,
})
