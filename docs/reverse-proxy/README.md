# Reverse proxy examples

Lernwerk expects TLS termination in a reverse proxy. Plain HTTP is only
supported on `localhost` (secure session cookies require HTTPS).

## Local testing with Safari

Safari (WebKit) does not store `Secure` cookies for `http://localhost`, so
signing in over plain HTTP fails there; Chrome, Edge and Firefox work. For
Safari, put Caddy in front even on your own machine:

```
localhost:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}
```

Set `LERNWERK_PUBLIC_URL=https://localhost:8443`, run `caddy trust` once to
install the local root certificate, and open https://localhost:8443.

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

## Content origin

The app container listens on two ports: 3000 for the app origin and 3001 for
the content origin (course playback). Compose publishes them as
`LERNWERK_HTTP_PORT` and `LERNWERK_CONTENT_HTTP_PORT`. The proxy forwards the
content host or port to the second one and must not add cookies or
authentication. Without `LERNWERK_CONTENT_URL` the second listener is not
started, own courses play on the app origin, and importing third-party
packages is disabled.

With a subdomain instead of a port (`https://content.example.org`), add a
second site block with `reverse_proxy 127.0.0.1:3001`.
