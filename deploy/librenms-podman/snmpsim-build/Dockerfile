# demo-simulated-hosts: pinned snmpsim image (FR-D1).
# tandrup/snmpsim has no maintained tag (only latest/v0.4/v0.2.4, Python2 era) ->
# design fallback: locally-built pinned image from PyPI snmpsim on python:3.12-slim.
# Base pinned BY DIGEST (resolved 2026-08-10):
FROM docker.io/library/python@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36
# snmpsim 1.2.2 pulls pysnmp 7.x, which loads USM MIBs at startup needing cryptography,
# and imports pysmi at runtime. Neither is a declared hard dep in this release chain,
# so both are pinned explicitly (reproducible, no surprise resolution).
RUN pip install --no-cache-dir \
      snmpsim==1.2.2 \
      pysmi==2.0.0 \
      cryptography==46.0.3
RUN useradd -r -u 1000 -m snmpsim || true
USER 1000
EXPOSE 1161/udp
ENTRYPOINT ["snmpsim-command-responder"]
