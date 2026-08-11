"""Idempotent fix: a variable in proxy_pass disables nginx automatic prefix rewrite, so the /bff
prefix must be stripped explicitly. Replaces the /bff proxy_pass with a rewrite + variable upstream.
Run on the host from ~/nms/config."""
c = open("nginx.conf").read()
old = (
    "      set $bff_upstream nms-bff;\n"
    "      # Strip the /bff prefix: the BFF mounts /auth/* and /api/v1/* at its root.\n"
    "      proxy_pass http://$bff_upstream:4000/;"
)
new = (
    "      set $bff_upstream nms-bff;\n"
    "      # Strip the /bff prefix: BFF mounts /auth/* and /api/v1/* at root. A variable in\n"
    "      # proxy_pass disables the automatic prefix rewrite, so strip it explicitly.\n"
    "      rewrite ^/bff/(.*)$ /$1 break;\n"
    "      proxy_pass http://$bff_upstream:4000;"
)
if new in c:
    print("already fixed")
elif old in c:
    open("nginx.conf", "w").write(c.replace(old, new, 1))
    print("bff rewrite fixed")
else:
    print("ERROR expected /bff block not found")
