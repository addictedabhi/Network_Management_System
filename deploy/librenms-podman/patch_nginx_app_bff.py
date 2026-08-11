"""
Additive, idempotent nginx-gateway patch (Task A): insert `location /app` (AIRNMS custom UI) and
`location /bff/` (AIRNMS BFF) into the EXISTING :8443 server block, WITHOUT touching the working
`location /` (native LibreNMS + oauth2-proxy SSO). Aborts if the native-UI marker is missing or if
already patched. Run on the host from ~/nms/config (operates on ./nginx.conf in place).
"""
import sys

conf = open("nginx.conf").read()

block = """
    # ---- AIRNMS custom UI (Next.js) at the subpath /app - Task A, ADDITIVE/non-destructive ----
    # More-specific than `location /`, so it never hits the oauth2-proxy auth_request that gates the
    # native LibreNMS UI. The custom UI runs its OWN OIDC flow via the BFF (/bff/auth/*); it is NOT
    # behind oauth2-proxy. basePath=/app is baked into the Next build so all assets live under /app.
    location /app {
      set $web_upstream nms-web;
      proxy_pass http://$web_upstream:3000$request_uri;
      proxy_set_header Host $host:8443;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Host $host:8443;
      proxy_read_timeout 60s;
    }

    # ---- AIRNMS BFF (Node) at /bff/* - Task A, ADDITIVE ----
    # The sole data plane for the custom UI (ADR 0002). Token-bearing calls happen SERVER-SIDE inside
    # the BFF; the browser only ever sends the opaque session cookie to same-origin /bff/*. It is not
    # auth_request gated (the BFF enforces its own session) and is not the LibreNMS /api/ path.
    location /bff/ {
      set $bff_upstream nms-bff;
      # Strip the /bff prefix: BFF mounts /auth/* and /api/v1/* at root. A variable in proxy_pass
      # disables the automatic prefix rewrite, so strip it explicitly.
      rewrite ^/bff/(.*)$ /$1 break;
      proxy_pass http://$bff_upstream:4000;
      proxy_set_header Host $host:8443;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Host $host:8443;
      # Strip any client-supplied identity headers on the way in (defence in depth).
      proxy_set_header X-Remote-User "";
      proxy_set_header X-Remote-Groups "";
      proxy_read_timeout 60s;
    }

"""

marker = "    # ---- LibreNMS native UI: OIDC-gated via oauth2-proxy ----"
if marker not in conf:
    print("ERROR native-UI marker not found - no change")
    sys.exit(2)
if "location /app" in conf:
    print("ERROR already patched - no change")
    sys.exit(2)
conf = conf.replace(marker, block + marker, 1)
open("nginx.conf", "w").write(conf)
print("patched OK; new size", len(conf))
