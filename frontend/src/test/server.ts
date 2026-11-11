import { setupServer } from 'msw/node'

import { adminHandlers } from './fakeAdmin'
import { attentionHandlers } from './fakeAttention'
import { handlers } from './fakeBackend'
import { homeHandlers } from './fakeHome'
import { incidentHandlers } from './fakeIncidents'
import { planningHandlers } from './fakePlanning'
import { surveyHandlers } from './fakeSurvey'

export const server = setupServer(
  ...handlers,
  ...homeHandlers,
  ...surveyHandlers,
  ...adminHandlers,
  ...attentionHandlers,
  ...planningHandlers,
  ...incidentHandlers,
)
