import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin_/shops/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin_/shops/"!</div>
}
