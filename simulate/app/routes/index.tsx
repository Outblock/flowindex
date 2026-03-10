import { createFileRoute } from '@tanstack/react-router'
import { Hero } from '@/components/hero'
import { Features } from '@/components/features'
import { HowItWorks } from '@/components/how-it-works'
import { ApiSection } from '@/components/api-section'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main>
      <Hero />
      <Features />
      <HowItWorks />
      <ApiSection />
    </main>
  )
}
