# Reverse proxy examples

Lernwerk expects TLS termination in a reverse proxy. Plain HTTP is only
supported on `localhost` (secure session cookies require HTTPS).

## Caddy with an internal CA (LAN without public DNS)

1. Install Caddy on the Docker host and use [`Caddyfile`](Caddyfile).
2. Make `lernwerk.lan` resolve to the host (DNS server or hosts files).
3. Start Caddy once; it creates its local CA. The root certificate is at
   `$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt`
   (usually `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`).
4. Import `root.crt` on every client as a trusted root certificate:
   - **Windows:** `certutil -addstore -f ROOT root.crt` (admin shell), or
     Group Policy for many machines.
   - **macOS:** `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root.crt`
   - **Debian/Ubuntu:** copy to `/usr/local/share/ca-certificates/lernwerk.crt`,
     then `sudo update-ca-certificates`.
   - **Firefox** uses its own store unless `security.enterprise_roots.enabled`
     is set; import via Settings → Certificates → Authorities.
5. Restart the browsers.

Examples for Traefik and nginx follow with the content listener in Phase 2.
