export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Web checkout sends the platform header so the server can enforce the iOS
  // payment policy. It must be explicitly allowed or the browser stops at the
  // CORS preflight before `order-pay` ever sees the authenticated request.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
export function preflight(request) {
  return request.method === "OPTIONS" ? new Response("ok", {
    headers: corsHeaders
  }) : null;
}
