// Rutas internas relativas al `base` de Astro. En Vercel el sitio vive en la raíz
// ('/'), pero en cPanel se publica bajo un subdirectorio (/carrier-international/),
// así que ninguna ruta interna debe escribirse con '/' al inicio a mano.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Antepone el base a una ruta del sitio: withBase('/images/x.webp'). */
export const withBase = (path) => `${BASE}${path}`;

/** Quita el base de un pathname para compararlo con rutas del sitio ('/', '/en/'...). */
export const stripBase = (pathname) =>
  (BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname) || '/';
