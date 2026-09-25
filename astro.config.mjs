// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// `npm run build:cpanel` genera un sitio estático para el hosting cPanel, que lo
// sirve bajo un subdirectorio. El build normal sigue siendo el de Vercel en la raíz.
const isCpanel = process.env.DEPLOY_TARGET === 'cpanel';

// https://astro.build/config
export default defineConfig({
  adapter: isCpanel ? undefined : vercel(),
  // `site` da las URLs absolutas de canonical y hreflang. Solo en cPanel: el build
  // de Vercel vive en otro dominio y ahí esas etiquetas se quedan relativas.
  site: isCpanel ? 'https://tle.com.mx' : undefined,
  base: isCpanel ? '/carrier-international' : '/',
  outDir: isCpanel ? './dist-cpanel' : './dist',

  i18n: {
    locales: ['es', 'en'],
    defaultLocale: 'es',
    routing: {
      prefixDefaultLocale: false
    }
  },

  vite: {
    plugins: [tailwindcss()]
  }
});
