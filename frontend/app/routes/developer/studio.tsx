import { createFileRoute } from '@tanstack/react-router'
import DeveloperLayout from '../../components/developer/DeveloperLayout'

export const Route = createFileRoute('/developer/studio')({
  component: StudioPage,
})

const SIM_STUDIO_URL = import.meta.env.VITE_SIM_STUDIO_URL || 'https://studio.flowindex.io'
const WORKSPACE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function StudioPage() {
  return (
    <DeveloperLayout>
      <iframe
        src={`${SIM_STUDIO_URL}/workspace/${WORKSPACE_ID}/w`}
        className="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write"
        title="FlowIndex Studio"
      />
    </DeveloperLayout>
  )
}
