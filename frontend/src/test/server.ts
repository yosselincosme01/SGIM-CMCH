import { setupServer } from 'msw/node'

import { handlers } from './fakeBackend'
import { incidentHandlers } from './fakeIncidents'

export const server = setupServer(...handlers, ...incidentHandlers)
