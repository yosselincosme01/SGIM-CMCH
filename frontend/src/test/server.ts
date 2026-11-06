import { setupServer } from 'msw/node'

import { handlers } from './fakeBackend'

export const server = setupServer(...handlers)
