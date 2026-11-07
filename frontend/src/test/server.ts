import { setupServer } from 'msw/node'

import { handlers } from './fakeBackend'
import { incidentHandlers } from './fakeIncidents'
import { planningHandlers } from './fakePlanning'

export const server = setupServer(...handlers, ...planningHandlers, ...incidentHandlers)
