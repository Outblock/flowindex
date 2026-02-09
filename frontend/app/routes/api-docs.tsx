import { createFileRoute } from '@tanstack/react-router'
import ApiDocs from '../components/ApiDocs'

export const Route = createFileRoute('/api-docs')({
    component: ApiDocsPage,
})

function ApiDocsPage() {
    return <ApiDocs specUrl="/openapi/v2.json" />
}
