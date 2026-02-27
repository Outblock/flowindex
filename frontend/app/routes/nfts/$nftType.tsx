import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/nfts/$nftType')({
  component: () => <Outlet />,
})
