import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/**
 * Provider responses are always mocked; no unit or component test may depend on
 * the live Audius service (agents/09_TESTING_QA.md, agents/12 → Rule 10).
 */
export const server = setupServer(...handlers)
