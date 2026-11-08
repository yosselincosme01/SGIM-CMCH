import { setupServer } from 'msw/node'

import { adminHandlers } from './fakeAdmin'
import { attentionHandlers } from './fakeAttention'
import { handlers } from './fakeBackend'
import { incidentHandlers } from './fakeIncidents'
import { planningHandlers } from './fakePlanning'

export const server = setupServer(
  ...handlers,
  ...adminHandlers,
  ...attentionHandlers,
  ...planningHandlers,
  ...incidentHandlers,
)
