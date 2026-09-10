import type { APIRoute } from 'astro';

export const prerender = false;

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const SENDER_EMAIL = import.meta.env.BREVO_SENDER_EMAIL || 'noreply@futurite.info';
const RECIPIENT_EMAILS = ['contacto@tle.com.mx'];

/* Listas cerradas: deben coincidir con los <select> de la landing. */
const TIPOS_OPERACION = new Set([
	'Exportación (México → EE. UU.)',
	'Importación (EE. UU. → México)',
	'Ambas',
]);
const TIPOS_SERVICIO = new Set([
	'Caja Seca Crossborder (Dry Van)',
	'Plataformas (Flatbed)',
	'Nodrizas (Madrinas)',
	'Movimientos Contenerizados',
]);
const FRECUENCIAS = new Set(['Semanal', 'Mensual']);

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;
const UTM_LABELS: Record<(typeof UTM_KEYS)[number], string> = {
	utm_source: 'UTM Source',
	utm_medium: 'UTM Medium',
	utm_campaign: 'UTM Campaign',
	utm_term: 'UTM Term',
	utm_content: 'UTM Content',
	gclid: 'Google Click ID',
};
const UTM_VALUE_REGEX = /^[A-Za-z0-9._\-|%{}()+ ]{1,200}$/;
const ORIGEN_REGEX = /^\/[A-Za-z0-9\-._~/?&=%+]{0,300}$/;

const NOMBRE_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\s.'-]{3,100}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFONO_REGEX = /^[0-9()+\-\s]{10,20}$/;
const TEXTO_CORTO_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,&'/()-]{2,150}$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const MIN_FILL_TIME_MS = 3000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const timestamps = (requestLog.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

	if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
		requestLog.set(ip, timestamps);
		return true;
	}

	timestamps.push(now);
	requestLog.set(ip, timestamps);
	return false;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

interface Regla {
	regex: RegExp;
	label: string;
	mensaje: string;
}

const REGLAS: Record<string, Regla> = {
	nombre: { regex: NOMBRE_REGEX, label: 'Nombre y apellido', mensaje: 'Ingresa tu nombre y apellido.' },
	empresa: { regex: TEXTO_CORTO_REGEX, label: 'Empresa', mensaje: 'Ingresa el nombre de la empresa.' },
	correo: { regex: EMAIL_REGEX, label: 'Correo corporativo', mensaje: 'Ingresa un correo válido.' },
	telefono: { regex: TELEFONO_REGEX, label: 'Teléfono', mensaje: 'Ingresa un teléfono válido (mínimo 10 dígitos).' },
	ciudad_origen: { regex: TEXTO_CORTO_REGEX, label: 'País y ciudad de origen', mensaje: 'Indica país y ciudad de origen.' },
	destino: { regex: TEXTO_CORTO_REGEX, label: 'País y ciudad de destino', mensaje: 'Indica país y ciudad de destino.' },
	carga: { regex: TEXTO_CORTO_REGEX, label: 'Tipo de carga', mensaje: 'Indica el tipo de carga.' },
};

const LISTAS: Record<string, { valores: Set<string>; label: string; mensaje: string }> = {
	operacion: { valores: TIPOS_OPERACION, label: 'Tipo de operación', mensaje: 'Selecciona el tipo de operación.' },
	servicio: { valores: TIPOS_SERVICIO, label: 'Tipo de servicio / unidad', mensaje: 'Selecciona el tipo de servicio o unidad.' },
	frecuencia: { valores: FRECUENCIAS, label: 'Frecuencia', mensaje: 'Selecciona la frecuencia.' },
};

/**
 * Verifica el token de Turnstile.
 * Mientras el cliente no entregue sus claves, la landing usa el par de prueba de
 * Cloudflare y aquí se valida contra el secret de prueba. Si ya hay site key real
 * pero falta el secret, se omite la verificación en lugar de rechazar a todo el mundo.
 */
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

async function turnstileValido(token: string, ip: string): Promise<boolean> {
	const secretReal = import.meta.env.TURNSTILE_SECRET_KEY;
	const enPruebas = !import.meta.env.PUBLIC_TURNSTILE_SITE_KEY && !secretReal;
	const secret = secretReal || (enPruebas ? TURNSTILE_TEST_SECRET : '');
	if (!secret) return true;
	if (!token) return false;

	try {
		const res = await fetch(TURNSTILE_VERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, response: token, remoteip: ip }),
		});
		const data = (await res.json()) as { success?: boolean };
		return data.success === true;
	} catch (err) {
		console.error('Turnstile verification failed:', err);
		return false;
	}
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let body: Record<string, unknown>;

	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Solicitud inválida.' }), { status: 400 });
	}

	// Honeypot: un bot llena todos los campos, incluido el que la persona no ve.
	if (typeof body.website === 'string' && body.website.trim() !== '') {
		return new Response(JSON.stringify({ success: true }), { status: 200 });
	}

	// Trampa de tiempo: nadie llena este formulario en menos de tres segundos.
	const formLoadedAt = Number(body.formLoadedAt);
	if (!formLoadedAt || Date.now() - formLoadedAt < MIN_FILL_TIME_MS) {
		return new Response(JSON.stringify({ error: 'Solicitud inválida.' }), { status: 400 });
	}

	const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
	if (isRateLimited(ip)) {
		return new Response(
			JSON.stringify({ error: 'Demasiadas solicitudes. Intenta más tarde.' }),
			{ status: 429 }
		);
	}

	const token = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : '';
	if (!(await turnstileValido(token, ip))) {
		return new Response(
			JSON.stringify({ error: 'No pudimos verificar que eres una persona. Intenta de nuevo.' }),
			{ status: 403 }
		);
	}

	const errors: Record<string, string> = {};
	const clean: Record<string, string> = {};

	for (const [campo, regla] of Object.entries(REGLAS)) {
		const raw = body[campo];
		const valor = typeof raw === 'string' ? raw.trim() : '';

		if (!valor) {
			errors[campo] = 'Este campo es obligatorio.';
		} else if (!regla.regex.test(valor)) {
			errors[campo] = regla.mensaje;
		} else {
			clean[campo] = valor;
		}
	}

	for (const [campo, lista] of Object.entries(LISTAS)) {
		const raw = body[campo];
		const valor = typeof raw === 'string' ? raw.trim() : '';

		if (!valor) {
			errors[campo] = 'Este campo es obligatorio.';
		} else if (!lista.valores.has(valor)) {
			errors[campo] = lista.mensaje;
		} else {
			clean[campo] = valor;
		}
	}

	const fecha = typeof body.fecha === 'string' ? body.fecha.trim() : '';
	if (!fecha) {
		errors.fecha = 'Este campo es obligatorio.';
	} else if (!FECHA_REGEX.test(fecha) || Number.isNaN(Date.parse(fecha))) {
		errors.fecha = 'Elige una fecha válida.';
	} else {
		clean.fecha = fecha;
	}

	if (Object.keys(errors).length > 0) {
		return new Response(JSON.stringify({ errors }), { status: 422 });
	}

	// Ruta de la landing desde donde se envió (campo oculto `origen`).
	const origenRaw = typeof body.origen === 'string' ? body.origen.trim() : '';
	const origen = ORIGEN_REGEX.test(origenRaw) ? origenRaw : '/';

	// Las UTMs son opcionales: el tráfico orgánico no las trae.
	const utmData: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
	for (const key of UTM_KEYS) {
		const raw = body[key];
		const valor = typeof raw === 'string' ? raw.trim() : '';
		if (valor && UTM_VALUE_REGEX.test(valor)) {
			utmData[key] = valor;
		}
	}

	const referer = request.headers.get('referer') || new URL(request.url).origin + origen;

	const utmRows = UTM_KEYS.filter((key) => utmData[key]).map(
		(key) => `<p><strong>${UTM_LABELS[key]}:</strong> ${escapeHtml(utmData[key]!)}</p>`
	);
	const utmSection = utmRows.length
		? `<hr />\n\t\t<p><strong>Datos de campaña</strong></p>\n\t\t${utmRows.join('\n\t\t')}`
		: '<hr />\n\t\t<p><strong>Datos de campaña:</strong> sin UTMs (tráfico directo u orgánico).</p>';

	const htmlContent = `
		<h2>Nueva solicitud de cotización internacional</h2>
		<p>Recibida desde la landing page de Carrier Internacional (TLE).</p>
		<p><strong>Nombre:</strong> ${escapeHtml(clean.nombre)}</p>
		<p><strong>Empresa:</strong> ${escapeHtml(clean.empresa)}</p>
		<p><strong>Correo:</strong> ${escapeHtml(clean.correo)}</p>
		<p><strong>Teléfono:</strong> ${escapeHtml(clean.telefono)}</p>
		<hr />
		<p><strong>Origen:</strong> ${escapeHtml(clean.ciudad_origen)}</p>
		<p><strong>Destino:</strong> ${escapeHtml(clean.destino)}</p>
		<p><strong>Tipo de operación:</strong> ${escapeHtml(clean.operacion)}</p>
		<p><strong>Tipo de servicio / unidad:</strong> ${escapeHtml(clean.servicio)}</p>
		<p><strong>Tipo de carga:</strong> ${escapeHtml(clean.carga)}</p>
		<p><strong>Frecuencia:</strong> ${escapeHtml(clean.frecuencia)}</p>
		<p><strong>Fecha estimada de movimiento:</strong> ${escapeHtml(clean.fecha)}</p>
		${utmSection}
		<hr />
		<p><strong>Origen del envío:</strong> ${escapeHtml(origen)}</p>
		<p>Este mensaje fue enviado automáticamente desde: ${escapeHtml(referer)}</p>
	`;

	const apiKey = import.meta.env.BREVO_API_KEY;
	if (!apiKey) {
		console.error('BREVO_API_KEY no está configurada: el lead no se envió.', {
			...clean,
			...utmData,
			origen,
		});
		return new Response(
			JSON.stringify({ error: 'El envío no está configurado todavía. Intenta más tarde.' }),
			{ status: 503 }
		);
	}

	try {
		const brevoResponse = await fetch(BREVO_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'api-key': apiKey,
			},
			body: JSON.stringify({
				sender: { email: SENDER_EMAIL, name: 'TLE - Carrier Internacional' },
				to: RECIPIENT_EMAILS.map((email) => ({ email })),
				replyTo: { email: clean.correo, name: clean.nombre },
				subject: `Nueva solicitud de cotización internacional - ${clean.nombre}`,
				htmlContent,
			}),
		});

		if (!brevoResponse.ok) {
			const errorBody = await brevoResponse.text();
			console.error('Brevo API error:', brevoResponse.status, errorBody);
			return new Response(
				JSON.stringify({ error: 'No se pudo enviar la solicitud. Intenta de nuevo.' }),
				{ status: 502 }
			);
		}
	} catch (err) {
		console.error('Brevo request failed:', err);
		return new Response(
			JSON.stringify({ error: 'No se pudo enviar la solicitud. Intenta de nuevo.' }),
			{ status: 502 }
		);
	}

	return new Response(JSON.stringify({ success: true }), { status: 200 });
};
