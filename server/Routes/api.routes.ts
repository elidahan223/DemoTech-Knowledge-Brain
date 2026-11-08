import { Router } from 'express';
import { createCatalogController } from '../Controllers/CatalogController.js';
import { createChatController } from '../Controllers/ChatController.js';
import { createDocumentsController } from '../Controllers/DocumentsController.js';
import { createGraphController } from '../Controllers/GraphController.js';
import { createJobsController } from '../Controllers/JobsController.js';
import { createSearchController } from '../Controllers/SearchController.js';
import { createSystemController } from '../Controllers/SystemController.js';
export function createApiRouter() {
  const router = Router();
  router.use(createCatalogController());
  router.use(createJobsController());
  router.use(createSystemController());
  router.use(createGraphController());
  router.use(createDocumentsController());
  router.use(createChatController());
  router.use(createSearchController());
  return router;
}
