import { setupServer } from 'msw/node'

import { adminHandlers } from './fakeAdmin'
import { attentionHandlers } from './fakeAttention'
import { handlers } from './fakeBackend'
import { homeHandlers } from './fakeHome'
import { incidentHandlers } from './fakeIncidents'
import { planningHandlers } from './fakePlanning'

export const server = setupServer(
  ...handlers,
  ...homeHandlers,
  ...adminHandlers,
  ...attentionHandlers,
  ...planningHandlers,
  ...incidentHandlers,
)
