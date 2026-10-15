import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/netlify-api.mjs';

export default (request, context) => createHandler({
  store: getStore({ name: 'lacortes-wedding-v1', consistency: 'strong' }),
  adminPassword: process.env.LACORTES_ADMIN_PASSWORD,
})(request, context);

export const config = { path: '/api/*' };
