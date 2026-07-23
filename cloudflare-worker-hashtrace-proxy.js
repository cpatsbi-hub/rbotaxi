// ============================================================
// Hashtrace proxy — deploy this on Cloudflare Workers (free tier)
//
// Purpose: your real Hashtrace authKey stays private on Cloudflare's
// servers. Your public GitHub Pages site calls THIS worker instead,
// with no secret in its own code. This worker attaches the real key
// server-side before forwarding to Hashtrace, and returns the result.
//
// SETUP:
// 1. Go to https://dash.cloudflare.com -> sign up free (no card needed)
// 2. Workers & Pages -> Create -> Create Worker -> name it e.g. "hashtrace-proxy"
// 3. Click "Edit code", delete the placeholder, paste this whole file in
// 4. Click "Save and Deploy"
// 5. Go to Settings -> Variables and Secrets -> Add:
//      - HASHTRACE_AUTH_KEY   (type: Secret)  = your real Hashtrace authKey
//      - ALLOWED_ORIGIN       (type: Text)    = your GitHub Pages site,
//        e.g. https://your-username.github.io   (no trailing slash)
// 6. Save, it redeploys automatically
// 7. Copy this worker's URL (shown at the top of its page, looks like
//    https://hashtrace-proxy.YOUR-SUBDOMAIN.workers.dev) — that's what
//    goes into js/live-map.js in the app.
// ============================================================

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.HASHTRACE_AUTH_KEY) {
      return new Response(JSON.stringify({ error: "Worker is missing HASHTRACE_AUTH_KEY — set it in Settings > Variables and Secrets." }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const upstreamUrl = `https://cdn.hashtrace.com/api/Tracker/All?authKey=${env.HASHTRACE_AUTH_KEY}`;

    try {
      const upstreamRes = await fetch(upstreamUrl);
      const body = await upstreamRes.text();
      return new Response(body, {
        status: upstreamRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Could not reach Hashtrace", detail: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
