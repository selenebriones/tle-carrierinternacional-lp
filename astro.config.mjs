// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // La landing se sigue generando estática; solo /api/lead corre en el servidor.
  adapter: vercel(),

  vite: {
    plugins: [tailwindcss()]
  }
});