import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { AhrefsBlock } from '@/blocks/blocks/ahrefs'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { AirweaveBlock } from '@/blocks/blocks/airweave'
import { AlgoliaBlock } from '@/blocks/blocks/algolia'
import { AmplitudeBlock } from '@/blocks/blocks/amplitude'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { AsanaBlock } from '@/blocks/blocks/asana'
import { AshbyBlock } from '@/blocks/blocks/ashby'
import { AttioBlock } from '@/blocks/blocks/attio'
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { CalComBlock } from '@/blocks/blocks/calcom'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock } from '@/blocks/blocks/circleback'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ClerkBlock } from '@/blocks/blocks/clerk'
import { CloudflareBlock } from '@/blocks/blocks/cloudflare'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock, ConfluenceV2Block } from '@/blocks/blocks/confluence'
import { CursorBlock, CursorV2Block } from '@/blocks/blocks/cursor'
import { DatabricksBlock } from '@/blocks/blocks/databricks'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { DevinBlock } from '@/blocks/blocks/devin'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { DropboxBlock } from '@/blocks/blocks/dropbox'
import { DSPyBlock } from '@/blocks/blocks/dspy'
import { DuckDuckGoBlock } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EnrichBlock } from '@/blocks/blocks/enrich'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock } from '@/blocks/blocks/exa'
import { FileBlock, FileV2Block, FileV3Block } from '@/blocks/blocks/file'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FlowGetAccountBlock } from '@/blocks/blocks/flow_get_account'
import { FlowGetBalanceBlock } from '@/blocks/blocks/flow_get_balance'
import { FlowGetBlockBlock } from '@/blocks/blocks/flow_get_block'
import { FlowGetEventsBlock } from '@/blocks/blocks/flow_get_events'
import { FlowGetFtHoldingsBlock } from '@/blocks/blocks/flow_get_ft_holdings'
import { FlowGetNftBlock } from '@/blocks/blocks/flow_get_nft'
import { FlowGetNftInventoryBlock } from '@/blocks/blocks/flow_get_nft_inventory'
import { FlowGetTransactionBlock } from '@/blocks/blocks/flow_get_transaction'
import { FlowResolveNameBlock } from '@/blocks/blocks/flow_resolve_name'
import { FirefliesBlock, FirefliesV2Block } from '@/blocks/blocks/fireflies'
import { FlowGetCollectionMetadataBlock } from '@/blocks/blocks/flow_get_collection_metadata'
import { FlowGetContractCodeBlock } from '@/blocks/blocks/flow_get_contract_code'
import { FlowGetDefiPositionsBlock } from '@/blocks/blocks/flow_get_defi_positions'
import { FlowGetStakingInfoBlock } from '@/blocks/blocks/flow_get_staking_info'
import { FlowExecuteScriptBlock } from '@/blocks/blocks/flow_execute_script'
import { FlowSendTransactionBlock } from '@/blocks/blocks/flow_send_transaction'
import { FlowTransferFlowBlock } from '@/blocks/blocks/flow_transfer_flow'
import { FlowTransferFtBlock } from '@/blocks/blocks/flow_transfer_ft'
import { FlowTransferNftBlock } from '@/blocks/blocks/flow_transfer_nft'
import { FlowStakeBlock } from '@/blocks/blocks/flow_stake'
import { FlowUnstakeBlock } from '@/blocks/blocks/flow_unstake'
import { FlowWithdrawRewardsBlock } from '@/blocks/blocks/flow_withdraw_rewards'
import { FlowEvmCallBlock } from '@/blocks/blocks/flow_evm_call'
import { FlowEvmSendBlock } from '@/blocks/blocks/flow_evm_send'
import { FlowCreateAccountBlock } from '@/blocks/blocks/flow_create_account'
import { FlowAddKeyBlock } from '@/blocks/blocks/flow_add_key'
import { FlowRemoveKeyBlock } from '@/blocks/blocks/flow_remove_key'
import { FlowBatchTransferBlock } from '@/blocks/blocks/flow_batch_transfer'
import { FlowMultiSignBlock } from '@/blocks/blocks/flow_multi_sign'
import { FlowFormatAddressBlock } from '@/blocks/blocks/flow_format_address'
import { FlowDecodeEventBlock } from '@/blocks/blocks/flow_decode_event'
import { FlowEncodeArgumentsBlock } from '@/blocks/blocks/flow_encode_arguments'
import { FlowNftCatalogLookupBlock } from '@/blocks/blocks/flow_nft_catalog_lookup'
import { FlowTokenListLookupBlock } from '@/blocks/blocks/flow_token_list_lookup'
import { FlowIncrementFiBlock } from '@/blocks/blocks/flow_increment_fi'
import { FlowFlowIndexApiBlock } from '@/blocks/blocks/flow_flowindex_api'
import { FlowFindProfileBlock } from '@/blocks/blocks/flow_find_profile'
import { FlowTriggerBlock } from '@/blocks/blocks/flow_trigger'
import {
  FlowAccountEventTriggerBlock,
  FlowBalanceChangeTriggerBlock,
  FlowContractDeployTriggerBlock,
  FlowContractEventTriggerBlock,
  FlowDefiEventTriggerBlock,
  FlowEvmTxTriggerBlock,
  FlowFtTransferTriggerBlock,
  FlowLargeTransferTriggerBlock,
  FlowNewAccountTriggerBlock,
  FlowNftTransferTriggerBlock,
  FlowScheduleTriggerBlock,
  FlowStakingEventTriggerBlock,
  FlowTxSealedTriggerBlock,
  FlowWhaleActivityTriggerBlock,
} from '@/blocks/blocks/flow_triggers'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GammaBlock } from '@/blocks/blocks/gamma'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GitHubBlock, GitHubV2Block } from '@/blocks/blocks/github'
import { GitLabBlock } from '@/blocks/blocks/gitlab'
import { GmailBlock, GmailV2Block } from '@/blocks/blocks/gmail'
import { GongBlock } from '@/blocks/blocks/gong'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleBigQueryBlock } from '@/blocks/blocks/google_bigquery'
import { GoogleBooksBlock } from '@/blocks/blocks/google_books'
import { GoogleCalendarBlock, GoogleCalendarV2Block } from '@/blocks/blocks/google_calendar'
import { GoogleContactsBlock } from '@/blocks/blocks/google_contacts'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock } from '@/blocks/blocks/google_forms'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'
import { GoogleMapsBlock } from '@/blocks/blocks/google_maps'
import { GooglePagespeedBlock } from '@/blocks/blocks/google_pagespeed'
import { GoogleSheetsBlock, GoogleSheetsV2Block } from '@/blocks/blocks/google_sheets'
import { GoogleSlidesBlock, GoogleSlidesV2Block } from '@/blocks/blocks/google_slides'
import { GoogleTasksBlock } from '@/blocks/blocks/google_tasks'
import { GoogleTranslateBlock } from '@/blocks/blocks/google_translate'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import { GrafanaBlock } from '@/blocks/blocks/grafana'
import { GrainBlock } from '@/blocks/blocks/grain'
import { GreenhouseBlock } from '@/blocks/blocks/greenhouse'
import { GreptileBlock } from '@/blocks/blocks/greptile'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HexBlock } from '@/blocks/blocks/hex'
import { HubSpotBlock } from '@/blocks/blocks/hubspot'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { HunterBlock } from '@/blocks/blocks/hunter'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { ImapBlock } from '@/blocks/blocks/imap'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { IntercomBlock, IntercomV2Block } from '@/blocks/blocks/intercom'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import { KalshiBlock, KalshiV2Block } from '@/blocks/blocks/kalshi'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LangsmithBlock } from '@/blocks/blocks/langsmith'
import { LemlistBlock } from '@/blocks/blocks/lemlist'
import { LinearBlock } from '@/blocks/blocks/linear'
import { LinkedInBlock } from '@/blocks/blocks/linkedin'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { LoopsBlock } from '@/blocks/blocks/loops'
import { LumaBlock } from '@/blocks/blocks/luma'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { MailgunBlock } from '@/blocks/blocks/mailgun'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftDataverseBlock } from '@/blocks/blocks/microsoft_dataverse'
import { MicrosoftExcelBlock, MicrosoftExcelV2Block } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import {
  MistralParseBlock,
  MistralParseV2Block,
  MistralParseV3Block,
} from '@/blocks/blocks/mistral_parse'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { MySQLBlock } from '@/blocks/blocks/mysql'
import { Neo4jBlock } from '@/blocks/blocks/neo4j'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotionBlock, NotionV2Block } from '@/blocks/blocks/notion'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import { OnePasswordBlock } from '@/blocks/blocks/onepassword'
import { OpenAIBlock } from '@/blocks/blocks/openai'
import { OutlookBlock } from '@/blocks/blocks/outlook'
import { PagerDutyBlock } from '@/blocks/blocks/pagerduty'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import { PineconeBlock } from '@/blocks/blocks/pinecone'
import { PipedriveBlock } from '@/blocks/blocks/pipedrive'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { PostgreSQLBlock } from '@/blocks/blocks/postgresql'
import { PostHogBlock } from '@/blocks/blocks/posthog'
import { PulseBlock, PulseV2Block } from '@/blocks/blocks/pulse'
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { RDSBlock } from '@/blocks/blocks/rds'
import { RedditBlock } from '@/blocks/blocks/reddit'
import { RedisBlock } from '@/blocks/blocks/redis'
import { ReductoBlock, ReductoV2Block } from '@/blocks/blocks/reducto'
import { ResendBlock } from '@/blocks/blocks/resend'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RevenueCatBlock } from '@/blocks/blocks/revenuecat'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock } from '@/blocks/blocks/rss'
import { S3Block } from '@/blocks/blocks/s3'
import { SalesforceBlock } from '@/blocks/blocks/salesforce'
import { SendEmailBlock } from '@/blocks/blocks/send_email'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SendGridBlock } from '@/blocks/blocks/sendgrid'
import { SentryBlock } from '@/blocks/blocks/sentry'
import { SerperBlock } from '@/blocks/blocks/serper'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { SftpBlock } from '@/blocks/blocks/sftp'
import { SharepointBlock } from '@/blocks/blocks/sharepoint'
import { ShopifyBlock } from '@/blocks/blocks/shopify'
import { SimilarwebBlock } from '@/blocks/blocks/similarweb'
import { SlackBlock } from '@/blocks/blocks/slack'
import { SmtpBlock } from '@/blocks/blocks/smtp'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import { SQSBlock } from '@/blocks/blocks/sqs'
import { SSHBlock } from '@/blocks/blocks/ssh'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { SttBlock, SttV2Block } from '@/blocks/blocks/stt'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { TextractBlock, TextractV2Block } from '@/blocks/blocks/textract'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TinybirdBlock } from '@/blocks/blocks/tinybird'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock } from '@/blocks/blocks/trello'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { UpstashBlock } from '@/blocks/blocks/upstash'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VercelBlock } from '@/blocks/blocks/vercel'
import { VideoGeneratorBlock, VideoGeneratorV2Block } from '@/blocks/blocks/video_generator'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { WebflowBlock } from '@/blocks/blocks/webflow'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock } from '@/blocks/blocks/wikipedia'
import { WordPressBlock } from '@/blocks/blocks/wordpress'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { XBlock } from '@/blocks/blocks/x'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import { ZendeskBlock } from '@/blocks/blocks/zendesk'
import { ZepBlock } from '@/blocks/blocks/zep'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import type { BlockConfig } from '@/blocks/types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  a2a: A2ABlock,
  agent: AgentBlock,
  ahrefs: AhrefsBlock,
  airtable: AirtableBlock,
  airweave: AirweaveBlock,
  algolia: AlgoliaBlock,
  amplitude: AmplitudeBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  apify: ApifyBlock,
  apollo: ApolloBlock,
  arxiv: ArxivBlock,
  asana: AsanaBlock,
  ashby: AshbyBlock,
  attio: AttioBlock,
  browser_use: BrowserUseBlock,
  calcom: CalComBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  cloudflare: CloudflareBlock,
  clay: ClayBlock,
  clerk: ClerkBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  confluence_v2: ConfluenceV2Block,
  cursor: CursorBlock,
  cursor_v2: CursorV2Block,
  databricks: DatabricksBlock,
  datadog: DatadogBlock,
  devin: DevinBlock,
  discord: DiscordBlock,
  dropbox: DropboxBlock,
  dspy: DSPyBlock,
  duckduckgo: DuckDuckGoBlock,
  dynamodb: DynamoDBBlock,
  elasticsearch: ElasticsearchBlock,
  elevenlabs: ElevenLabsBlock,
  enrich: EnrichBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  firecrawl: FirecrawlBlock,
  fireflies: FirefliesBlock,
  fireflies_v2: FirefliesV2Block,
  flow_get_account: FlowGetAccountBlock,
  flow_get_balance: FlowGetBalanceBlock,
  flow_get_block: FlowGetBlockBlock,
  flow_get_collection_metadata: FlowGetCollectionMetadataBlock,
  flow_get_contract_code: FlowGetContractCodeBlock,
  flow_get_defi_positions: FlowGetDefiPositionsBlock,
  flow_execute_script: FlowExecuteScriptBlock,
  flow_get_events: FlowGetEventsBlock,
  flow_get_ft_holdings: FlowGetFtHoldingsBlock,
  flow_get_nft: FlowGetNftBlock,
  flow_get_nft_inventory: FlowGetNftInventoryBlock,
  flow_get_staking_info: FlowGetStakingInfoBlock,
  flow_get_transaction: FlowGetTransactionBlock,
  flow_resolve_name: FlowResolveNameBlock,
  flow_send_transaction: FlowSendTransactionBlock,
  flow_transfer_flow: FlowTransferFlowBlock,
  flow_transfer_ft: FlowTransferFtBlock,
  flow_transfer_nft: FlowTransferNftBlock,
  flow_stake: FlowStakeBlock,
  flow_unstake: FlowUnstakeBlock,
  flow_withdraw_rewards: FlowWithdrawRewardsBlock,
  flow_evm_call: FlowEvmCallBlock,
  flow_evm_send: FlowEvmSendBlock,
  flow_create_account: FlowCreateAccountBlock,
  flow_add_key: FlowAddKeyBlock,
  flow_remove_key: FlowRemoveKeyBlock,
  flow_batch_transfer: FlowBatchTransferBlock,
  flow_multi_sign: FlowMultiSignBlock,
  flow_format_address: FlowFormatAddressBlock,
  flow_decode_event: FlowDecodeEventBlock,
  flow_encode_arguments: FlowEncodeArgumentsBlock,
  flow_nft_catalog_lookup: FlowNftCatalogLookupBlock,
  flow_token_list_lookup: FlowTokenListLookupBlock,
  flow_increment_fi: FlowIncrementFiBlock,
  flow_flowindex_api: FlowFlowIndexApiBlock,
  flow_find_profile: FlowFindProfileBlock,
  flow_trigger: FlowTriggerBlock,
  flow_account_event_trigger: FlowAccountEventTriggerBlock,
  flow_balance_change_trigger: FlowBalanceChangeTriggerBlock,
  flow_contract_deploy_trigger: FlowContractDeployTriggerBlock,
  flow_contract_event_trigger: FlowContractEventTriggerBlock,
  flow_defi_event_trigger: FlowDefiEventTriggerBlock,
  flow_evm_tx_trigger: FlowEvmTxTriggerBlock,
  flow_ft_transfer_trigger: FlowFtTransferTriggerBlock,
  flow_large_transfer_trigger: FlowLargeTransferTriggerBlock,
  flow_new_account_trigger: FlowNewAccountTriggerBlock,
  flow_nft_transfer_trigger: FlowNftTransferTriggerBlock,
  flow_schedule_trigger: FlowScheduleTriggerBlock,
  flow_staking_event_trigger: FlowStakingEventTriggerBlock,
  flow_tx_sealed_trigger: FlowTxSealedTriggerBlock,
  flow_whale_activity_trigger: FlowWhaleActivityTriggerBlock,
  function: FunctionBlock,
  gamma: GammaBlock,
  generic_webhook: GenericWebhookBlock,
  github: GitHubBlock,
  github_v2: GitHubV2Block,
  gitlab: GitLabBlock,
  gmail: GmailBlock,
  gmail_v2: GmailV2Block,
  google_calendar: GoogleCalendarBlock,
  google_calendar_v2: GoogleCalendarV2Block,
  google_books: GoogleBooksBlock,
  google_contacts: GoogleContactsBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_groups: GoogleGroupsBlock,
  google_maps: GoogleMapsBlock,
  google_pagespeed: GooglePagespeedBlock,
  google_tasks: GoogleTasksBlock,
  google_translate: GoogleTranslateBlock,
  gong: GongBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  google_sheets_v2: GoogleSheetsV2Block,
  google_slides: GoogleSlidesBlock,
  google_slides_v2: GoogleSlidesV2Block,
  google_bigquery: GoogleBigQueryBlock,
  google_vault: GoogleVaultBlock,
  grafana: GrafanaBlock,
  grain: GrainBlock,
  greenhouse: GreenhouseBlock,
  greptile: GreptileBlock,
  guardrails: GuardrailsBlock,
  hex: HexBlock,
  hubspot: HubSpotBlock,
  huggingface: HuggingFaceBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  hunter: HunterBlock,
  image_generator: ImageGeneratorBlock,
  imap: ImapBlock,
  incidentio: IncidentioBlock,
  input_trigger: InputTriggerBlock,
  intercom: IntercomBlock,
  intercom_v2: IntercomV2Block,
  jina: JinaBlock,
  jira: JiraBlock,
  jira_service_management: JiraServiceManagementBlock,
  kalshi: KalshiBlock,
  kalshi_v2: KalshiV2Block,
  knowledge: KnowledgeBlock,
  langsmith: LangsmithBlock,
  lemlist: LemlistBlock,
  linear: LinearBlock,
  linkedin: LinkedInBlock,
  linkup: LinkupBlock,
  loops: LoopsBlock,
  luma: LumaBlock,
  mailchimp: MailchimpBlock,
  mailgun: MailgunBlock,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  mem0: Mem0Block,
  memory: MemoryBlock,
  microsoft_dataverse: MicrosoftDataverseBlock,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_excel_v2: MicrosoftExcelV2Block,
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  mistral_parse_v2: MistralParseV2Block,
  mistral_parse_v3: MistralParseV3Block,
  mongodb: MongoDBBlock,
  mysql: MySQLBlock,
  neo4j: Neo4jBlock,
  note: NoteBlock,
  notion: NotionBlock,
  notion_v2: NotionV2Block,
  onepassword: OnePasswordBlock,
  onedrive: OneDriveBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  pagerduty: PagerDutyBlock,
  parallel_ai: ParallelBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  pipedrive: PipedriveBlock,
  polymarket: PolymarketBlock,
  postgresql: PostgreSQLBlock,
  posthog: PostHogBlock,
  pulse: PulseBlock,
  pulse_v2: PulseV2Block,
  qdrant: QdrantBlock,
  rds: RDSBlock,
  reddit: RedditBlock,
  redis: RedisBlock,
  reducto: ReductoBlock,
  reducto_v2: ReductoV2Block,
  resend: ResendBlock,
  response: ResponseBlock,
  revenuecat: RevenueCatBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  s3: S3Block,
  salesforce: SalesforceBlock,
  send_email: SendEmailBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  sendgrid: SendGridBlock,
  sentry: SentryBlock,
  serper: SerperBlock,
  servicenow: ServiceNowBlock,
  sftp: SftpBlock,
  sharepoint: SharepointBlock,
  shopify: ShopifyBlock,
  similarweb: SimilarwebBlock,
  slack: SlackBlock,
  smtp: SmtpBlock,
  spotify: SpotifyBlock,
  sqs: SQSBlock,
  ssh: SSHBlock,
  stagehand: StagehandBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  stripe: StripeBlock,
  stt: SttBlock,
  stt_v2: SttV2Block,
  supabase: SupabaseBlock,
  // TODO: Uncomment when working on tables
  // table: TableBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  textract: TextractBlock,
  textract_v2: TextractV2Block,
  thinking: ThinkingBlock,
  tinybird: TinybirdBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  tts: TtsBlock,
  twilio_sms: TwilioSMSBlock,
  twilio_voice: TwilioVoiceBlock,
  typeform: TypeformBlock,
  upstash: UpstashBlock,
  vercel: VercelBlock,
  variables: VariablesBlock,
  video_generator: VideoGeneratorBlock,
  video_generator_v2: VideoGeneratorV2Block,
  vision: VisionBlock,
  vision_v2: VisionV2Block,
  wait: WaitBlock,
  wealthbox: WealthboxBlock,
  webflow: WebflowBlock,
  webhook_request: WebhookRequestBlock,
  whatsapp: WhatsAppBlock,
  wikipedia: WikipediaBlock,
  wordpress: WordPressBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  x: XBlock,
  youtube: YouTubeBlock,
  zendesk: ZendeskBlock,
  zep: ZepBlock,
  zoom: ZoomBlock,
}

export const getBlock = (type: string): BlockConfig | undefined => {
  if (registry[type]) {
    return registry[type]
  }
  const normalized = type.replace(/-/g, '_')
  return registry[normalized]
}

export const getLatestBlock = (baseType: string): BlockConfig | undefined => {
  const normalized = baseType.replace(/-/g, '_')

  const versionedKeys = Object.keys(registry).filter((key) => {
    const match = key.match(new RegExp(`^${normalized}_v(\\d+)$`))
    return match !== null
  })

  if (versionedKeys.length > 0) {
    const sorted = versionedKeys.sort((a, b) => {
      const versionA = Number.parseInt(a.match(/_v(\d+)$/)?.[1] || '0', 10)
      const versionB = Number.parseInt(b.match(/_v(\d+)$/)?.[1] || '0', 10)
      return versionB - versionA
    })
    return registry[sorted[0]]
  }

  return registry[normalized]
}

export const getBlockByToolName = (toolName: string): BlockConfig | undefined => {
  return Object.values(registry).find((block) => block.tools?.access?.includes(toolName))
}

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string =>
  type in registry || type.replace(/-/g, '_') in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
