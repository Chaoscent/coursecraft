# Windows sign-in (Kerberos) and directory login

Coursecraft offers two ways to use a company directory (Active Directory or
another LDAP server). They can be combined.

| Method                    | Provider kind in Coursecraft    | What the person does                        |
| ------------------------- | ------------------------------- | ------------------------------------------- |
| User name and password    | LDAP / Active Directory         | Types the network user name and password.   |
| Automatic Windows sign-in | Windows sign-in (reverse proxy) | Clicks "Sign in with Windows"; no password. |

The local administrator account keeps working next to both ("Local account"
in the sign-in selector). Keep it as the break-glass account.

## 1. Directory login (LDAP)

Administration → Single sign-on → New provider → LDAP / Active Directory.

- **Server address:** `ldaps://dc.example.com`, or `ldap://…` together with
  StartTLS. Plain LDAP is refused: passwords would travel unencrypted.
- **Certificate authority:** paste your internal CA certificate (PEM) if the
  domain controller's certificate is not issued by a public CA.
- **Service account:** a normal domain account with read rights, used only
  for the user search. Its password is stored encrypted.
- **Search base and filter:** for Active Directory
  `OU=Staff,DC=example,DC=com` and
  `(&(objectClass=user)(sAMAccountName={username}))`. Unique attribute
  `objectGUID`, e-mail `mail`, name `displayName`, groups `memberOf`.
- **Groups and roles:** one line per mapping, `group DN => role`. Roles are
  `learner`, `author`, `trainer`; administrator is never granted from the
  directory. Applied at every sign-in.
- **Only members of this group:** restricts who may sign in at all. For
  nested groups use the in-chain filter
  `(&(objectClass=user)(sAMAccountName={username})(memberOf:1.2.840.113556.1.4.1941:=CN=Courses,OU=Groups,DC=example,DC=com))`.

## 2. Automatic Windows sign-in (Kerberos through a reverse proxy)

Coursecraft does not speak Kerberos itself. A web server in front of it does,
and tells Coursecraft who the person is. This keeps keytabs and native
Kerberos libraries out of the application. The same pattern works with Apache
(`mod_auth_gssapi`) and IIS (Windows authentication).

```
Browser ──Kerberos ticket──> Apache / IIS ──X-Remote-User──> Coursecraft
                             (only for /api/auth/proxy/…)
```

### 2.1 Provider in Coursecraft

Administration → Single sign-on → New provider → Windows sign-in.

- **Header:** `x-remote-user` (any name; the proxy must set it).
- **Trusted proxies:** the address or network of the proxy (CIDR). Requests
  from any other address are refused, so a client that reaches Coursecraft
  directly cannot pretend to be someone else.
- **Shared secret** (recommended): the proxy sends it in a second header
  (`x-proxy-secret`); at least 16 random characters.
- **Strip the domain:** turns `jdoe@EXAMPLE.COM` or `EXAMPLE\jdoe` into
  `jdoe`. Needed when a directory is used with `sAMAccountName`.
- **Directory:** choose the LDAP provider from section 1 to get e-mail, name
  and groups; accounts then match those created by the password login. Without
  a directory the Windows account must look like an e-mail address
  (`jdoe@example.com`), otherwise only already linked accounts can sign in.

After saving, the dialog shows the path to protect:
`https://courses.example.com/api/auth/proxy/<id>/login`.

### 2.2 Apache (Debian/Ubuntu)

Sketch; adapt names and verify in your environment.

```apache
<VirtualHost *:443>
  ServerName courses.example.com
  # TLS settings omitted (see docs/reverse-proxy/README.md)
  ProxyPreserveHost On
  ProxyPass        / http://127.0.0.1:3000/
  ProxyPassReverse / http://127.0.0.1:3000/

  # Never accept the account header from a client, on any path.
  RequestHeader unset X-Remote-User
  RequestHeader unset X-Proxy-Secret

  <Location "/api/auth/proxy/">
    AuthType GSSAPI
    AuthName "Coursecraft"
    GssapiCredStore keytab:/etc/apache2/coursecraft.keytab
    GssapiBasicAuth Off
    Require valid-user

    RewriteEngine On
    RewriteCond %{LA-U:REMOTE_USER} (.+)
    RewriteRule .* - [E:RU=%1,NS]
    RequestHeader set X-Remote-User "%{RU}e" env=RU
    RequestHeader set X-Proxy-Secret "the-shared-secret"
  </Location>
</VirtualHost>
```

Keytab for the web server (run on a domain controller, once):

```
ktpass -princ HTTP/courses.example.com@EXAMPLE.COM -mapuser EXAMPLE\svc-courses \
  -crypto AES256-SHA1 -ptype KRB5_NT_PRINCIPAL -pass * -out coursecraft.keytab
```

The DNS name must be an A record (not a CNAME), or the ticket will not match.
The keytab belongs to the web server only (`chmod 600`).

### 2.3 IIS

Put IIS in front with Application Request Routing, enable Windows
authentication only for the `/api/auth/proxy` path, and add a URL Rewrite rule
that copies `LOGON_USER` into the `X-Remote-User` request header (and removes
any client-supplied one). Set the shared secret header the same way.

### 2.4 Browsers by group policy

The browsers only send a ticket to sites they consider "intranet".

- **Edge and Chrome:** policy `AuthServerAllowlist` = `courses.example.com`
  (Administrative Templates → Microsoft Edge / Google Chrome → HTTP
  authentication → "Configure list of allowed authentication servers").
- **Internet Explorer mode / Windows zone mapping:** Computer or User
  Configuration → Administrative Templates → Windows Components → Internet
  Explorer → Internet Control Panel → Security Page → "Site to Zone Assignment
  List": `https://courses.example.com` = `1` (Intranet).
- **Firefox:** `network.negotiate-auth.trusted-uris` = `courses.example.com`
  through `policies.json` or the Firefox group policy templates.

### 2.5 Checklist

1. The application port is reachable **only** from the proxy (firewall or a
   Docker network), not from user networks.
2. The proxy overwrites or removes `X-Remote-User` and the secret header on
   every request.
3. The trusted proxy list contains only the proxy.
4. A failed attempt is logged by Coursecraft (`proxy sign-in from an address
that is not a trusted proxy`) and appears in the audit log as a failed
   single sign-on.

## 3. Not covered yet

- The application itself negotiating Kerberos (no proxy); needs native
  libraries and a keytab in the image.
- Scheduled directory sync that deactivates accounts which left the directory.
- Throttling of sign-in attempts per account (the directory's lockout policy
  still applies).

This guide was written without access to a domain; the Apache, IIS and group
policy settings follow the vendors' documentation and are not verified
against a live domain. The Coursecraft side (trusted peers, secret, directory
lookup, role mapping) is covered by automated tests.
