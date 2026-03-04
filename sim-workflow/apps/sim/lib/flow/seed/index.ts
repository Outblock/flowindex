import { db } from '@sim/db'
import { templates, templateCreators } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { FLOW_TEMPLATES } from './flow-templates'

const logger = createLogger('FlowSeed')

const FLOW_CREATOR_ID = 'flow-official-creator'

let seeded = false

/**
 * Ensures the FlowIndex template creator profile exists.
 */
async function ensureFlowCreator(): Promise<void> {
  const existing = await db.query.templateCreators.findFirst({
    where: eq(templateCreators.id, FLOW_CREATOR_ID),
    columns: { id: true },
  })

  if (existing) return

  await db.insert(templateCreators).values({
    id: FLOW_CREATOR_ID,
    referenceType: 'organization',
    referenceId: 'flowindex',
    name: 'FlowIndex',
    profileImageUrl: null,
    details: {
      bio: 'Official Flow blockchain workflow templates by FlowIndex',
      website: 'https://flowindex.io',
    },
    verified: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

/**
 * Seeds the Flow workflow templates into the templates table.
 * Safe to call multiple times — skips existing templates.
 */
export async function seedFlowTemplates(): Promise<void> {
  if (seeded) return

  try {
    await ensureFlowCreator()

    for (const tmpl of FLOW_TEMPLATES) {
      const existing = await db.query.templates.findFirst({
        where: eq(templates.id, tmpl.id),
        columns: { id: true },
      })

      if (existing) continue

      await db.insert(templates).values({
        id: tmpl.id,
        workflowId: null,
        name: tmpl.name,
        details: tmpl.details,
        creatorId: FLOW_CREATOR_ID,
        views: 0,
        stars: 0,
        status: 'approved',
        tags: tmpl.tags,
        requiredCredentials: [],
        state: tmpl.state,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      logger.info(`Seeded Flow template: ${tmpl.name}`)
    }

    seeded = true
  } catch (error) {
    logger.warn('Failed to seed Flow templates', { error })
  }
}
