/**
 * Pages Function: forward every /api/* request to the Hono Worker through a
 * service binding. The player and the API then share one origin, so the
 * HttpOnly session cookie is sent with <audio> and <img> requests too.
 */
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = ({ request, env }) => env.API.fetch(request);
