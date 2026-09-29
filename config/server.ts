import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'https://studylab-backend-vsbb.onrender.com'),
  // FIX: naye Strapi (5.24+) mein sirf `proxy: true` kaafi nahi hota.
  // Iska object form use karna padta hai taake Koa reverse-proxy
  // headers (X-Forwarded-Proto) ko sahi tarah trust kare, warna
  // Strapi request ko "unencrypted" samajh kar secure cookie
  // bhejne se inkar kar deta hai.
  proxy: {
    koa: true,
  },
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;